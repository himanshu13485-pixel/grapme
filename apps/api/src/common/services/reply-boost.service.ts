import { BadRequestException, Injectable } from '@nestjs/common';
import { EventType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Re-aim the target after this much new mail, or this long — whichever comes first. */
const REAIM_SENDS = 250;
const REAIM_HOURS = 8;

/** Roles whose dashboards may show the adjusted figure. The client portal never does. */
const BOOSTED_ROLES: string[] = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES];

export interface ReplyFigures {
  replies: number;
  replyRate: number;
  /** True when the numbers are the presentation figure rather than the real one. */
  boosted: boolean;
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/**
 * The reply figure shown on staff dashboards.
 *
 * Off by default. When the super admin turns it on (My Account) the shown reply
 * count walks slowly inside the configured band instead of tracking the real
 * one: it never goes down, and it only ever grows by the band's top rate of
 * whatever new mail went out. So a refresh never changes it, the rate eases down
 * on its own as more mail goes out without more replies, and climbs again as the
 * target pulls it up.
 *
 * The real figures are always what the client portal, the per-client reports and
 * every export show.
 */
@Injectable()
export class ReplyBoostService {
  constructor(private prisma: PrismaService) {}

  private config(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { replyBoostEnabled: true, replyBoostMinPct: true, replyBoostMaxPct: true },
    });
  }

  /**
   * Figures for one dashboard. `scopeKey` keeps a separate walk per audience
   * (tenant-wide, a scoped sub-admin, a salesperson), since each sees a
   * different slice of the sending.
   */
  async apply(
    tenantId: string,
    role: string,
    scopeKey: string,
    sent: number,
    actualReplies: number,
  ): Promise<ReplyFigures> {
    const real: ReplyFigures = {
      replies: actualReplies,
      replyRate: pct(actualReplies, sent),
      boosted: false,
    };
    if (!BOOSTED_ROLES.includes(role) || sent <= 0) return real;
    const cfg = await this.config(tenantId);
    if (!cfg?.replyBoostEnabled) return real;

    const min = clampPct(cfg.replyBoostMinPct);
    const max = Math.max(min, clampPct(cfg.replyBoostMaxPct));
    const state = await this.prisma.replyBoostState.findUnique({
      where: { tenantId_scopeKey: { tenantId, scopeKey } },
    });

    const stale =
      !state ||
      Date.now() - state.updatedAt.getTime() >= REAIM_HOURS * 3_600_000 ||
      sent - state.lastSent >= REAIM_SENDS;
    const target = stale
      ? this.nextTarget(min, max, state?.targetPct)
      : (state?.targetPct ?? this.nextTarget(min, max));

    const newSends = Math.max(0, sent - (state?.lastSent ?? 0));
    // Headroom: at most the band's top rate of the mail that just went out, so
    // the shown count climbs in step with real sending rather than in jumps.
    const room = Math.max(newSends > 0 ? 1 : 0, Math.round((newSends * max) / 100));
    const desired = Math.round((sent * target) / 100);
    let shown = state?.shownReplies ?? desired; // first run lands inside the band
    if (desired > shown) shown = Math.min(desired, shown + room);
    const floor = Math.round((sent * min) / 100);
    if (shown < floor) shown = Math.min(floor, shown + room);
    shown = Math.max(shown, actualReplies); // never hide a real reply

    if (
      !state ||
      state.shownReplies !== shown ||
      state.lastSent !== sent ||
      state.targetPct !== target
    ) {
      await this.prisma.replyBoostState.upsert({
        where: { tenantId_scopeKey: { tenantId, scopeKey } },
        update: { shownReplies: shown, lastSent: sent, targetPct: target },
        create: { tenantId, scopeKey, shownReplies: shown, lastSent: sent, targetPct: target },
      });
    }
    return { replies: shown, replyRate: pct(shown, sent), boosted: true };
  }

  /** A small step from the last target, so the rate wanders rather than jumping. */
  private nextTarget(min: number, max: number, prev?: number | null): number {
    const span = max - min;
    if (prev == null) return round1(min + Math.random() * span);
    const step = (Math.random() - 0.5) * Math.max(0.2, span * 0.5);
    return round1(Math.min(max, Math.max(min, prev + step)));
  }

  /** Settings plus the real and shown figures, for My Account. */
  async settings(tenantId: string) {
    const [cfg, sent, replies, state] = await Promise.all([
      this.config(tenantId),
      this.prisma.emailEvent.count({
        where: { eventType: EventType.SENT, message: { tenantId, cohortId: { not: null } } },
      }),
      this.prisma.emailEvent.count({
        where: { eventType: EventType.REPLY, message: { tenantId, cohortId: { not: null } } },
      }),
      this.prisma.replyBoostState.findUnique({
        where: { tenantId_scopeKey: { tenantId, scopeKey: 'tenant' } },
      }),
    ]);
    const shownReplies = cfg?.replyBoostEnabled
      ? Math.max(state?.shownReplies ?? replies, replies)
      : replies;
    return {
      enabled: !!cfg?.replyBoostEnabled,
      minPct: cfg?.replyBoostMinPct ?? 5.5,
      maxPct: cfg?.replyBoostMaxPct ?? 7.5,
      actual: { sent, replies, replyRate: pct(replies, sent) },
      shown: { replies: shownReplies, replyRate: pct(shownReplies, sent) },
    };
  }

  async update(tenantId: string, dto: { enabled?: boolean; minPct?: number; maxPct?: number }) {
    const min = dto.minPct === undefined ? undefined : clampPct(dto.minPct);
    const max = dto.maxPct === undefined ? undefined : clampPct(dto.maxPct);
    if (min !== undefined && max !== undefined && max < min) {
      throw new BadRequestException('The highest rate must be at least the lowest.');
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.enabled !== undefined ? { replyBoostEnabled: dto.enabled } : {}),
        ...(min !== undefined ? { replyBoostMinPct: min } : {}),
        ...(max !== undefined ? { replyBoostMaxPct: max } : {}),
      },
    });
    // A new band re-aims every audience's walk on the next dashboard load.
    await this.prisma.replyBoostState.deleteMany({ where: { tenantId } });
    return this.settings(tenantId);
  }
}
