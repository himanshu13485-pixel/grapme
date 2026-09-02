import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LiCampaignStatus, LinkedInAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';
import { mapProviderStatus } from '../provider/unipile.provider';
import { LiSchedulerService } from '../scheduler/li-scheduler.service';

@Injectable()
export class LinkedInAccountsService {
  private readonly logger = new Logger(LinkedInAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: LinkedInSubscriptionService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
    private readonly scheduler: LiSchedulerService,
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
    return accounts.map((a) => ({ ...a, deactivated }));
  }

  async get(id: string) {
    const a = await this.prisma.linkedInAccount.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Account not found');
    return a;
  }

  async sync(id: string) {
    const a = await this.get(id);
    if (!a.unipileAccountId) return a;
    const info = await this.provider.getAccount(a.unipileAccountId);
    // Account was deleted on Unipile's side → drop the stale local row so it stops
    // showing as connected. If a campaign still references it (FK), we can't hard-
    // delete, so fall back to marking it disconnected.
    if (info.deleted) {
      try {
        await this.prisma.linkedInAccount.delete({ where: { id } });
        return { id, removed: true };
      } catch {
        return this.prisma.linkedInAccount.update({
          where: { id },
          data: { status: LinkedInAccountStatus.DISCONNECTED, lastSyncedAt: new Date() },
        });
      }
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
      return { ok: true, status };
    }

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
    // Campaigns require this account (FK), so a plain delete 500s once any campaign
    // is attached. Remove the account's campaigns first — their leads + scheduled
    // actions cascade from the campaign — then the account, atomically.
    await this.prisma.$transaction([
      this.prisma.liCampaign.deleteMany({ where: { linkedInAccountId: id } }),
      this.prisma.linkedInAccount.delete({ where: { id } }),
    ]);
    return { ok: true };
  }
}
