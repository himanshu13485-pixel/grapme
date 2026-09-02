import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Thrown when a seat has spent its daily profile-read budget. */
export class ProfileBudgetExceededError extends Error {
  readonly code = 'PROFILE_BUDGET_EXCEEDED';
  constructor(readonly accountId: string, readonly limit: number) {
    super(`Daily profile-read budget exhausted for seat ${accountId} (limit ${limit})`);
    this.name = 'ProfileBudgetExceededError';
  }
}

/** Provider errors that mean "LinkedIn is pushing back" — the engine must stop, not retry. */
export function isPushbackError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '').toLowerCase();
  return (
    msg.includes('checkpoint') ||
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('credentials') ||
    msg.includes('unauthorized') ||
    msg.includes('restricted')
  );
}

const DEFAULT_PROFILE_LIMIT = 80;

/**
 * Meters the provider calls that spend LinkedIn's profile-view budget.
 *
 * LinkedIn restricts accounts that read "a high volume of profile data" — the failure
 * mode that got a seat flagged before this existed. The counter lives next to the
 * provider rather than at each call site so that a new call path cannot silently
 * reintroduce unbounded profile reads.
 */
@Injectable()
export class LiRateGuard {
  private readonly logger = new Logger(LiRateGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  /** UTC calendar day key, "YYYY-MM-DD". */
  static day(at: Date = new Date()): string {
    return at.toISOString().slice(0, 10);
  }

  private async profileLimit(accountId: string): Promise<number> {
    const acct = await this.prisma.linkedInAccount.findUnique({
      where: { unipileAccountId: accountId },
      select: { dailyProfileLimit: true },
    });
    return acct?.dailyProfileLimit ?? DEFAULT_PROFILE_LIMIT;
  }

  /**
   * Book one profile read against today's budget, or throw.
   *
   * Increments first and checks the result, so concurrent workers can't both pass a
   * read-then-write check. That over-counts rejected attempts by design: erring toward
   * refusing calls is the safe direction when the penalty is a restricted account.
   */
  async spendProfileCall(accountId: string): Promise<void> {
    const limit = await this.profileLimit(accountId);
    const day = LiRateGuard.day();
    const row = await this.prisma.liApiUsage.upsert({
      where: { accountId_day: { accountId, day } },
      create: { accountId, day, profileCalls: 1 },
      update: { profileCalls: { increment: 1 } },
    });
    if (row.profileCalls > limit) {
      this.logger.warn(`Profile budget exhausted for ${accountId}: ${row.profileCalls}/${limit} today`);
      throw new ProfileBudgetExceededError(accountId, limit);
    }
    if (row.profileCalls === Math.floor(limit * 0.8)) {
      this.logger.warn(`Seat ${accountId} at 80% of its daily profile budget (${row.profileCalls}/${limit})`);
    }
  }

  /** Record a non-profile action for observability (never throws — caps live elsewhere). */
  async note(accountId: string, kind: 'invite' | 'message'): Promise<void> {
    const day = LiRateGuard.day();
    const field = kind === 'invite' ? 'inviteCalls' : 'messageCalls';
    await this.prisma.liApiUsage
      .upsert({
        where: { accountId_day: { accountId, day } },
        create: { accountId, day, [field]: 1 },
        update: { [field]: { increment: 1 } },
      })
      .catch(() => undefined);
  }

  /** Remaining profile reads for a seat today (never negative). */
  async profileBudgetRemaining(accountId: string): Promise<{ used: number; limit: number; remaining: number }> {
    const limit = await this.profileLimit(accountId);
    const row = await this.prisma.liApiUsage.findUnique({
      where: { accountId_day: { accountId, day: LiRateGuard.day() } },
      select: { profileCalls: true },
    });
    const used = row?.profileCalls ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  }
}
