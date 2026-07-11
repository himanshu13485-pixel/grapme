import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LiCreditReason, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Client-level LinkedIn sending defaults, inherited by every new campaign. */
export interface LiCampaignDefaults {
  run247?: boolean;
  workStartHour?: number;
  workEndHour?: number;
  workDays?: number[];
  dailyConnectionLimit?: number;
  dailyMessageLimit?: number;
  warmupEnabled?: boolean;
  warmupStartLimit?: number;
  warmupDays?: number;
  dripEnabled?: boolean;
  dripDailyTarget?: number;
  dripBuffer?: number;
}

export interface UpdateLiSubscriptionDto {
  planName?: string;
  seats?: number;
  campaignLimit?: number;
  creditsBalance?: number;
  whatsappEnabled?: boolean;
  whatsappNumber?: string;
  timezone?: string;
  campaignDefaults?: LiCampaignDefaults;
}

/**
 * The LinkedIn subscription block for a shared Client — seats / validity / credits,
 * kept entirely separate from the email plan. Includes the LinkedIn credit ledger.
 */
@Injectable()
export class LinkedInSubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ensure a subscription row exists for this client (created lazily). */
  async getOrCreate(tenantId: string, clientId: string) {
    const existing = await this.prisma.linkedInSubscription.findUnique({ where: { clientId } });
    if (existing) return existing;
    return this.prisma.linkedInSubscription.create({ data: { tenantId, clientId } });
  }

  async get(clientId: string) {
    const s = await this.prisma.linkedInSubscription.findUnique({ where: { clientId } });
    if (!s) throw new NotFoundException('LinkedIn subscription not found');
    return s;
  }

  async update(tenantId: string, clientId: string, dto: UpdateLiSubscriptionDto) {
    await this.getOrCreate(tenantId, clientId);
    return this.prisma.linkedInSubscription.update({
      where: { clientId },
      data: {
        planName: dto.planName,
        seats: dto.seats,
        ...(typeof dto.campaignLimit === 'number' ? { campaignLimit: Math.max(0, Math.floor(dto.campaignLimit)) } : {}),
        ...(typeof dto.creditsBalance === 'number' ? { creditsBalance: Math.max(0, Math.floor(dto.creditsBalance)) } : {}),
        whatsappEnabled: dto.whatsappEnabled,
        whatsappNumber: dto.whatsappNumber,
        timezone: dto.timezone,
        ...(dto.campaignDefaults !== undefined ? { campaignDefaults: dto.campaignDefaults as Prisma.InputJsonValue } : {}),
      },
    });
  }

  async balance(clientId: string): Promise<number> {
    const s = await this.get(clientId);
    return s.creditsBalance;
  }

  topUp(tenantId: string, clientId: string, amount: number, note?: string) {
    if (amount <= 0) throw new BadRequestException('amount must be positive');
    return this.apply(tenantId, clientId, amount, LiCreditReason.TOPUP, { note });
  }

  /** Debit credits (e.g. AI Fetch). Atomic + overdraft-safe. */
  debit(
    tenantId: string,
    clientId: string,
    amount: number,
    reason: LiCreditReason,
    ref?: { refType?: string; refId?: string; note?: string },
  ) {
    if (amount <= 0) throw new BadRequestException('amount must be positive');
    return this.apply(tenantId, clientId, -amount, reason, ref);
  }

  private async apply(
    tenantId: string,
    clientId: string,
    delta: number,
    reason: LiCreditReason,
    ref?: { refType?: string; refId?: string; note?: string },
  ) {
    await this.getOrCreate(tenantId, clientId);
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.LinkedInSubscriptionWhereUniqueInput =
        delta < 0 ? { clientId, creditsBalance: { gte: -delta } as any } : { clientId };

      const updated = await tx.linkedInSubscription
        .update({ where, data: { creditsBalance: { increment: delta } }, select: { id: true, creditsBalance: true } })
        .catch(() => null);

      if (!updated) throw new BadRequestException('Insufficient LinkedIn credits');

      await tx.liCreditTransaction.create({
        data: {
          subscriptionId: updated.id,
          amount: delta,
          reason,
          balanceAfter: updated.creditsBalance,
          refType: ref?.refType,
          refId: ref?.refId,
          note: ref?.note,
        },
      });
      return updated.creditsBalance;
    });
  }
}
