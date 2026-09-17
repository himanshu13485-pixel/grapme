import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LiCampaignStatus, LinkedInAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { mapProviderStatus } from '../provider/unipile.provider';
import { LiSchedulerService } from '../scheduler/li-scheduler.service';
import { encryptCredential, decryptCredential } from '../../common/crypto/credential-crypto';
import { AdminAlertsService } from '../../notifications/admin-alerts.service';

@Injectable()
export class LinkedInAccountsService {
  private readonly logger = new Logger(LinkedInAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: LinkedInSubscriptionService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
    private readonly scheduler: LiSchedulerService,
    private readonly alerts: AdminAlertsService,
  ) {}

  /** Begin connecting a new LinkedIn account (seat) for a client. Returns a hosted-auth URL. */
  async createConnectLink(tenantId: string, clientId: string, successRedirect?: string) {
    const sub = await this.subs.getOrCreate(tenantId, clientId);
    // Reuse an existing un-connected (pending) seat instead of creating a new row —
    // so abandoning the Unipile login and retrying doesn't pile up orphan seats.
    let account = await this.prisma.linkedInAccount.findFirst({
      where: { clientId, status: LinkedInAccountStatus.PENDING, unipileAccountId: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!account) {
      const used = await this.prisma.linkedInAccount.count({ where: { clientId } });
      if (used >= sub.seats) {
        throw new BadRequestException('All LinkedIn seats in use — increase seats in the subscription to add accounts');
      }
      account = await this.prisma.linkedInAccount.create({
        data: { tenantId, clientId, status: LinkedInAccountStatus.PENDING },
      });
    }
    const link = await this.provider.createHostedAuthLink({ name: account.id, successRedirect });
    return { accountId: account.id, url: link.url };
  }

  async list(clientId: string) {
    const [accounts, client] = await Promise.all([
      this.prisma.linkedInAccount.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.client.findUnique({ where: { id: clientId }, select: { status: true } }),
    ]);
    // A seat is "deactivated" whenever its client is suspended (plan expired / deactivated) —
    // outreach is paused platform-wide, so surface it on every seat.
    const deactivated = !!client && client.status !== 'active';
    return accounts.map((a) => ({ ...this.redactProxy(a), deactivated }));
  }

  async get(id: string) {
    const a = await this.prisma.linkedInAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Account not found');
    return a;
  }

  /** Redacted read for API callers. get() stays raw — applyProxy needs the real secret. */
  async getPublic(id: string) {
    return this.redactProxy(await this.get(id));
  }

  async sync(id: string) {
    const a = await this.get(id);
    if (!a.unipileAccountId) return a;
    const info = await this.provider.getAccount(a.unipileAccountId);
    // Account was deleted on Unipile's side → drop the stale local row so it stops
    // showing as connected. If a campaign still references it (FK), we can't hard-
    // delete, so fall back to marking it disconnected.
    // Account was deleted on Unipile's side → drop the stale local row, keeping its
    // campaigns: they're paused and detached, not deleted along with it.
    if (info.deleted) {
      // Alert before the row goes, while its client and name are still readable.
      await this.alertSeatStopped(id, 'The account was deleted on the provider side, so the seat no longer exists.');
      await this.detachCampaigns(id, 'LinkedIn account was deleted — attach an account to resume');
      await this.prisma.linkedInAccount.delete({ where: { id } });
      return { id, removed: true };
    }
    const status = info.status as LinkedInAccountStatus;
    const healthy = status === LinkedInAccountStatus.CONNECTED;
    const updated = await this.prisma.linkedInAccount.update({
      where: { id },
      data: {
        status,
        fullName: info.fullName ?? a.fullName,
        headline: info.headline ?? a.headline,
        profileUrl: info.profileUrl ?? a.profileUrl,
        avatarUrl: info.avatarUrl ?? a.avatarUrl,
        connectionsCount: info.connectionsCount ?? a.connectionsCount,
        lastSyncedAt: new Date(),
        ...(healthy ? { pausedReason: null, pausedAt: null } : {}),
      },
    });
    // A sync that discovers the seat is no longer healthy stops its campaigns too —
    // the webhook is best-effort, so this is the second line of defence.
    if (!healthy && a.status === LinkedInAccountStatus.CONNECTED) {
      await this.pauseSeatCampaigns(id, `LinkedIn account status: ${status}`);
      await this.alertSeatStopped(id, `LinkedIn reports the account as ${status}.`);
    }
    return updated;
  }

  /** Unipile account webhook — `name` echoes our pending account id. */
  async handleAccountWebhook(payload: { account_id?: string; name?: string; status?: string }) {
    const rowId = payload.name;
    const unipileAccountId = payload.account_id;
    if (!rowId || !unipileAccountId) {
      this.logger.warn(`Account webhook missing name/account_id: ${JSON.stringify(payload)}`);
      return { ok: false };
    }
    const row = await this.prisma.linkedInAccount.findUnique({ where: { id: rowId } });
    if (!row) {
      this.logger.warn(`Account webhook for unknown row ${rowId}`);
      return { ok: false };
    }

    // Honour the status Unipile actually reported. This used to hardcode CONNECTED,
    // so a checkpoint or credentials failure left the seat looking healthy and the
    // engine kept sending into an account LinkedIn had already flagged.
    const status = mapProviderStatus(payload.status) as LinkedInAccountStatus;
    const healthy = status === LinkedInAccountStatus.CONNECTED;
    await this.prisma.linkedInAccount.update({
      where: { id: rowId },
      data: {
        unipileAccountId,
        status,
        ...(healthy
          ? { pausedReason: null, pausedAt: null }
          : { pausedReason: `Provider status: ${payload.status ?? 'unknown'}`, pausedAt: new Date() }),
      },
    });

    if (!healthy) {
      this.logger.warn(`Seat ${rowId} reported ${payload.status} — pausing its campaigns`);
      await this.pauseSeatCampaigns(rowId, `LinkedIn account status: ${payload.status ?? 'unknown'}`);
      // Only on the way down: the provider can repeat a status, and admins should not
      // get the same alert every time it does.
      if (row.status !== status) {
        await this.alertSeatStopped(rowId, `LinkedIn reports the account as ${payload.status ?? status}.`);
      }
      return { ok: true, status };
    }

    // Apply the seat's egress before anything starts sending through it. Unipile assigns
    // an IP near whoever completed the login, so a seat connected by us from our office
    // would otherwise run from our location rather than the client's.
    await this.applyProxy(rowId).catch(() => undefined);
    try { await this.sync(rowId); } catch (e) { this.logger.warn(`Post-connect sync failed: ${(e as Error).message}`); }
    return { ok: true, status };
  }

  /**
   * Circuit breaker: stop every campaign running on a seat.
   *
   * Called when the provider reports a non-OK status or pushes back (checkpoint / 429).
   * Continuing to send into a flagged account is what turns a LinkedIn warning into a
   * restriction, so the engine stops on its own rather than waiting for an operator.
   */
  async pauseSeatCampaigns(accountRowId: string, reason: string): Promise<number> {
    const running = await this.prisma.liCampaign.findMany({
      where: { linkedInAccountId: accountRowId, status: LiCampaignStatus.RUNNING },
      select: { id: true },
    });
    for (const c of running) {
      await this.prisma.liCampaign.update({ where: { id: c.id }, data: { status: LiCampaignStatus.PAUSED } });
      await this.scheduler.pauseCampaign(c.id).catch((e) => this.logger.warn(`Pause ${c.id} failed: ${(e as Error).message}`));
    }
    await this.prisma.linkedInAccount.update({
      where: { id: accountRowId },
      data: { pausedReason: reason, pausedAt: new Date() },
    }).catch(() => undefined);
    if (running.length) this.logger.warn(`Paused ${running.length} campaign(s) on seat ${accountRowId}: ${reason}`);
    return running.length;
  }

  /**
   * Set where this seat's traffic egresses from.
   *
   * Left alone, Unipile picks an IP near whoever completed the hosted-auth login — which
   * is whoever clicked the link, not necessarily the client. A seat that appears from a
   * different country than its owner normally uses trips checkpoints on its own, which is
   * why this is per seat rather than a global setting.
   *
   * Stores the config even when the seat isn't connected yet, and applies it on connect.
   */
  async setProxy(id: string, dto: {
    country?: string | null;
    host?: string | null; port?: number | null; protocol?: string | null;
    username?: string | null; password?: string | null;
  }) {
    const a = await this.get(id);
    const clearing = !dto.country && !dto.host;

    // A blank password on an otherwise-unchanged host means "keep what's stored" — the
    // API never returns the secret, so the UI cannot echo it back to us.
    const keepPassword = !!dto.host && dto.host === a.proxyHost && !dto.password;
    const password = clearing
      ? null
      : keepPassword
        ? a.proxyPassword
        : dto.password
          ? encryptCredential(dto.password)
          : null;

    const updated = await this.prisma.linkedInAccount.update({
      where: { id },
      data: {
        proxyCountry: clearing ? null : dto.country?.trim().toUpperCase() || null,
        proxyHost: clearing ? null : dto.host?.trim() || null,
        proxyPort: clearing ? null : dto.port ?? null,
        proxyProtocol: clearing ? null : dto.protocol || null,
        proxyUsername: clearing ? null : dto.username?.trim() || null,
        proxyPassword: password,
        proxyAppliedAt: null,
      },
    });

    if (a.unipileAccountId && !clearing) await this.applyProxy(id);
    return this.redactProxy(await this.get(id)) ?? updated;
  }

  /**
   * Push the stored proxy config to the provider. Best-effort by design: a proxy that
   * won't apply must not block connecting or syncing the seat, it just leaves the seat
   * on the provider's default egress with proxyAppliedAt unset.
   */
  async applyProxy(id: string): Promise<boolean> {
    const a = await this.get(id);
    if (!a.unipileAccountId) return false;
    const config = a.proxyHost && a.proxyPort
      ? {
        proxy: {
          host: a.proxyHost,
          port: a.proxyPort,
          protocol: (a.proxyProtocol as 'http' | 'https' | 'socks5' | null) ?? undefined,
          username: a.proxyUsername ?? undefined,
          password: a.proxyPassword ? decryptCredential(a.proxyPassword) : undefined,
        },
      }
      : a.proxyCountry
        ? { country: a.proxyCountry }
        : null;
    if (!config) return false;
    try {
      await this.provider.setAccountProxy(a.unipileAccountId, config);
      await this.prisma.linkedInAccount.update({ where: { id }, data: { proxyAppliedAt: new Date() } });
      return true;
    } catch (e) {
      this.logger.warn(`Could not apply proxy for seat ${id}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Never let the stored proxy password leave the API, encrypted or not. */
  private redactProxy<T extends { proxyPassword?: string | null } | null>(row: T): T {
    if (row && 'proxyPassword' in row) {
      return { ...row, proxyPassword: row.proxyPassword ? '••••••••' : null } as T;
    }
    return row;
  }

  /**
   * Tell the admins a seat stopped working — a checkpoint, a credentials failure, a
   * disconnect, or the account being deleted at the provider. Outreach on that seat is
   * paused until someone reconnects it, and nothing used to say so.
   */
  async alertSeatStopped(accountRowId: string, reason: string): Promise<void> {
    const seat = await this.prisma.linkedInAccount
      .findUnique({ where: { id: accountRowId }, select: { tenantId: true, clientId: true, fullName: true } })
      .catch(() => null);
    if (!seat) return;
    const client = await this.prisma.client
      .findUnique({ where: { id: seat.clientId }, select: { name: true } })
      .catch(() => null);
    await this.alerts.channelDisabled(seat.tenantId, {
      kind: 'LinkedIn account',
      name: seat.fullName || 'LinkedIn seat',
      clientName: client?.name ?? null,
      reason,
      whatNext: "Reconnect it from the client's LinkedIn → Accounts tab, then resume its campaigns.",
      link: `/linkedin/${seat.clientId}`,
    });
  }

  /** Same breaker, addressed by the provider-side account id (what the engine holds). */
  async pauseSeatByProviderId(unipileAccountId: string, reason: string): Promise<number> {
    const row = await this.prisma.linkedInAccount.findUnique({
      where: { unipileAccountId },
      select: { id: true },
    });
    if (!row) return 0;
    return this.pauseSeatCampaigns(row.id, reason);
  }

  async remove(id: string) {
    await this.get(id);
    const detached = await this.detachCampaigns(id, 'LinkedIn account removed — attach an account to resume');
    await this.prisma.linkedInAccount.delete({ where: { id } });
    return { ok: true, pausedCampaigns: detached };
  }

  /**
   * Stop every campaign on a seat and leave a note on each, ahead of the seat going away.
   *
   * Removing an account used to delete its campaigns outright — sequence, audience,
   * leads, history. Now the campaigns stay: they're paused here, and deleting the
   * account detaches them (the FK is ON DELETE SET NULL), ready to be re-attached.
   */
  private async detachCampaigns(accountRowId: string, reason: string): Promise<number> {
    await this.pauseSeatCampaigns(accountRowId, reason);
    const res = await this.prisma.liCampaign.updateMany({
      where: { linkedInAccountId: accountRowId },
      data: { pausedReason: reason },
    });
    return res.count;
  }
}
