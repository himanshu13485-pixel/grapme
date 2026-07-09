import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LinkedInAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LINKEDIN_PROVIDER, LinkedInProvider } from '../provider/linkedin-provider.interface';
import { LinkedInSubscriptionService } from '../subscription/linkedin-subscription.service';

@Injectable()
export class LinkedInAccountsService {
  private readonly logger = new Logger(LinkedInAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: LinkedInSubscriptionService,
    @Inject(LINKEDIN_PROVIDER) private readonly provider: LinkedInProvider,
  ) {}

  /** Begin connecting a new LinkedIn account (seat) for a client. Returns a hosted-auth URL. */
  async createConnectLink(tenantId: string, clientId: string, successRedirect?: string) {
    const sub = await this.subs.getOrCreate(tenantId, clientId);
    const used = await this.prisma.linkedInAccount.count({ where: { clientId } });
    if (used >= sub.seats) {
      throw new BadRequestException('All LinkedIn seats in use — increase seats in the subscription to add accounts');
    }
    const account = await this.prisma.linkedInAccount.create({
      data: { tenantId, clientId, status: LinkedInAccountStatus.PENDING },
    });
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
    return this.prisma.linkedInAccount.update({
      where: { id },
      data: {
        status: info.status as LinkedInAccountStatus,
        fullName: info.fullName ?? a.fullName,
        headline: info.headline ?? a.headline,
        profileUrl: info.profileUrl ?? a.profileUrl,
        avatarUrl: info.avatarUrl ?? a.avatarUrl,
        connectionsCount: info.connectionsCount ?? a.connectionsCount,
        lastSyncedAt: new Date(),
      },
    });
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
    await this.prisma.linkedInAccount.update({
      where: { id: rowId },
      data: { unipileAccountId, status: LinkedInAccountStatus.CONNECTED },
    });
    try { await this.sync(rowId); } catch (e) { this.logger.warn(`Post-connect sync failed: ${(e as Error).message}`); }
    return { ok: true };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.linkedInAccount.delete({ where: { id } });
    return { ok: true };
  }
}
