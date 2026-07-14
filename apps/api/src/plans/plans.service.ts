import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const DEFAULTS: { name: string; color: string }[] = [
  { name: 'Growth', color: '#0f766e' },
  { name: 'Growth Plus', color: '#0f766e' },
  { name: 'Enterprise', color: '#7c3aed' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
  }

  /**
   * Tell the marketing site (grapme.com) to refresh its live pricing page after a
   * plan changes. Fire-and-forget — never blocks or fails the admin action; if the
   * webhook is unset or unreachable, the page still refreshes on its ISR window.
   */
  private notifyMarketing() {
    const url = process.env.MARKETING_REVALIDATE_URL;
    if (!url) return;
    const secret = process.env.REVALIDATE_SECRET;
    void fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-revalidate-secret': secret } : {}),
      },
      body: JSON.stringify({ tag: 'public-plans' }),
    }).catch(() => {});
  }

  /** List the tenant's plans, self-seeding the defaults on first use. */
  async list(user: AuthUser) {
    let plans = await this.prisma.plan.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (plans.length === 0) {
      await this.prisma.plan.createMany({
        data: DEFAULTS.map((d, i) => ({
          tenantId: user.tenantId,
          name: d.name,
          color: d.color,
          sortOrder: i,
        })),
        skipDuplicates: true,
      });
      plans = await this.prisma.plan.findMany({
        where: { tenantId: user.tenantId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    }
    return plans;
  }

  /**
   * Public plan list for the marketing site (grapme.com/pricing) — no auth.
   * Returns the primary (oldest) tenant's plans with only presentation-safe
   * fields. Plans with no pricing configured are still returned so the site can
   * show them as "Custom / contact us".
   */
  async publicList() {
    const tenant = await this.prisma.tenant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!tenant) return [];
    const plans = await this.prisma.plan.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      emailEnabled: p.emailEnabled,
      linkedInEnabled: p.linkedInEnabled,
      validityDays: p.validityDays,
      emailCredits: p.emailCredits,
      linkedInCredits: p.linkedInCredits,
      mailboxLimit: p.mailboxLimit,
      seatLimit: p.seatLimit,
      emailCampaignLimit: p.emailCampaignLimit,
      linkedInCampaignLimit: p.linkedInCampaignLimit,
      pricing: Array.isArray(p.pricing) ? p.pricing : [],
      yearlyEntitlements: p.yearlyEntitlements ?? null,
      cardStyle: p.cardStyle,
      features: Array.isArray(p.features) ? p.features : [],
      popular: p.popular,
    }));
  }

  async create(user: AuthUser, name: string, color?: string) {
    this.assertAdmin(user);
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Plan name is required.');
    const exists = await this.prisma.plan.findFirst({
      where: { tenantId: user.tenantId, name: { equals: clean, mode: 'insensitive' } },
    });
    if (exists) throw new BadRequestException('That plan name already exists.');
    const max = await this.prisma.plan.aggregate({
      where: { tenantId: user.tenantId },
      _max: { sortOrder: true },
    });
    const created = await this.prisma.plan.create({
      data: {
        tenantId: user.tenantId,
        name: clean,
        color: color && HEX.test(color) ? color : '#0f766e',
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    this.notifyMarketing();
    return created;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: {
      name?: string; color?: string; sortOrder?: number;
      emailEnabled?: boolean; linkedInEnabled?: boolean;
      validityDays?: number | null;
      emailCredits?: number; linkedInCredits?: number;
      mailboxLimit?: number; seatLimit?: number;
      emailCampaignLimit?: number; linkedInCampaignLimit?: number;
      pricing?: unknown;
      yearlyEntitlements?: unknown;
      cardStyle?: string;
      features?: unknown;
      popular?: boolean;
    },
  ) {
    this.assertAdmin(user);
    const plan = await this.prisma.plan.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (dto.color !== undefined && !HEX.test(dto.color)) {
      throw new BadRequestException('Color must be a hex code like #7c3aed.');
    }
    // Renaming keeps existing clients pointed at the plan by name.
    if (dto.name && dto.name.trim() && dto.name.trim() !== plan.name) {
      const clash = await this.prisma.plan.findFirst({
        where: {
          tenantId: user.tenantId,
          name: { equals: dto.name.trim(), mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (clash) throw new BadRequestException('That plan name already exists.');
      await this.prisma.client.updateMany({
        where: { tenantId: user.tenantId, plan: plan.name },
        data: { plan: dto.name.trim() },
      });
    }
    // Non-negative integer, or undefined to leave the column unchanged.
    const n = (v?: number) => (typeof v === 'number' && v >= 0 ? Math.floor(v) : undefined);
    const updated = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.name && dto.name.trim() ? { name: dto.name.trim() } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.emailEnabled !== undefined ? { emailEnabled: !!dto.emailEnabled } : {}),
        ...(dto.linkedInEnabled !== undefined ? { linkedInEnabled: !!dto.linkedInEnabled } : {}),
        ...(n(dto.sortOrder) !== undefined ? { sortOrder: n(dto.sortOrder) } : {}),
        ...(dto.validityDays !== undefined ? { validityDays: dto.validityDays == null ? null : (n(dto.validityDays) ?? null) } : {}),
        ...(n(dto.emailCredits) !== undefined ? { emailCredits: n(dto.emailCredits) } : {}),
        ...(n(dto.linkedInCredits) !== undefined ? { linkedInCredits: n(dto.linkedInCredits) } : {}),
        ...(n(dto.mailboxLimit) !== undefined ? { mailboxLimit: n(dto.mailboxLimit) } : {}),
        ...(n(dto.seatLimit) !== undefined ? { seatLimit: n(dto.seatLimit) } : {}),
        ...(n(dto.emailCampaignLimit) !== undefined ? { emailCampaignLimit: n(dto.emailCampaignLimit) } : {}),
        ...(n(dto.linkedInCampaignLimit) !== undefined ? { linkedInCampaignLimit: n(dto.linkedInCampaignLimit) } : {}),
        ...(dto.pricing !== undefined ? { pricing: this.sanitizePricing(dto.pricing) } : {}),
        ...(dto.yearlyEntitlements !== undefined ? { yearlyEntitlements: this.sanitizeYearly(dto.yearlyEntitlements) } : {}),
        ...(dto.cardStyle !== undefined ? { cardStyle: dto.cardStyle === 'features' ? 'features' : 'entitlements' } : {}),
        ...(dto.features !== undefined ? { features: this.sanitizeFeatures(dto.features) } : {}),
        ...(dto.popular !== undefined ? { popular: !!dto.popular } : {}),
      },
    });
    this.notifyMarketing();
    return updated;
  }

  /** Feature bullets for the "features" card style — trimmed, de-blanked, capped. */
  private sanitizeFeatures(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().slice(0, 140))
      .filter(Boolean)
      .slice(0, 20);
  }

  /** Keep only the known numeric entitlement keys for the yearly override set. */
  private sanitizeYearly(input: unknown): Record<string, number> {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && v >= 0 && Number.isFinite(v) ? Math.floor(v) : undefined);
    const out: Record<string, number> = {};
    for (const k of ['emailCredits', 'linkedInCredits', 'mailboxLimit', 'seatLimit', 'emailCampaignLimit', 'linkedInCampaignLimit', 'validityDays']) {
      const v = n(o[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /** Normalise multi-currency pricing rows to a clean JSON array. */
  private sanitizePricing(input: unknown) {
    if (!Array.isArray(input)) return [];
    const money = (v: unknown) => (typeof v === 'number' && v >= 0 && Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
    return input
      .filter((p): p is Record<string, unknown> => !!p && typeof (p as any).currency === 'string' && (p as any).currency.trim())
      .map((p) => ({
        currency: String(p.currency).trim().toUpperCase().slice(0, 8),
        monthlyPrice: money(p.monthlyPrice), monthlyBest: money(p.monthlyBest),
        yearlyPrice: money(p.yearlyPrice), yearlyBest: money(p.yearlyBest),
      }))
      .slice(0, 30);
  }

  async remove(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const plan = await this.prisma.plan.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const inUse = await this.prisma.client.count({
      where: { tenantId: user.tenantId, plan: plan.name },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Can't delete "${plan.name}" — ${inUse} client${inUse === 1 ? '' : 's'} still use it.`,
      );
    }
    await this.prisma.plan.delete({ where: { id } });
    this.notifyMarketing();
    return { ok: true };
  }
}
