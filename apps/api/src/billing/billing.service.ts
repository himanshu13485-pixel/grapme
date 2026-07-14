import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { LinkedInSubscriptionService } from '../linkedin/subscription/linkedin-subscription.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CashfreeProvider } from './cashfree.provider';

interface PricingRow { currency: string; monthlyPrice: number; monthlyBest: number; yearlyPrice: number; yearlyBest: number }

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly liSubs: LinkedInSubscriptionService,
    private readonly cashfree: CashfreeProvider,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) throw new ForbiddenException('Admins only');
  }

  // ── settings ─────────────────────────────────────────────────────────
  async settings(user: AuthUser) {
    const t = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { paymentMode: true } });
    return { paymentMode: t?.paymentMode === 'AUTO' ? 'AUTO' : 'MANUAL', cashfreeConfigured: this.cashfree.configured };
  }
  async setMode(user: AuthUser, mode: string) {
    this.assertAdmin(user);
    const paymentMode = mode === 'AUTO' ? 'AUTO' : 'MANUAL';
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { paymentMode } });
    return { paymentMode };
  }

  // ── client requests a plan ───────────────────────────────────────────
  async requestPlan(user: AuthUser, dto: { clientId: string; plan: string; currency?: string; period?: string }) {
    const client = await this.prisma.client.findFirst({
      where: { id: dto.clientId, tenantId: user.tenantId, ...(user.role === Role.CLIENT ? { ownerUserId: user.userId } : {}) },
      select: { id: true, name: true, email: true, mobile: true, plan: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    const plan = await this.prisma.plan.findFirst({ where: { tenantId: user.tenantId, name: dto.plan } });
    if (!plan) throw new BadRequestException('Plan not found');

    const period = dto.period === 'yearly' ? 'yearly' : 'monthly';
    const rows = (plan.pricing as unknown as PricingRow[]) ?? [];
    const pr = dto.currency ? rows.find((r) => r.currency === dto.currency) : rows[0];
    const currency = pr?.currency ?? dto.currency ?? null;
    const amount = pr
      ? (period === 'yearly' ? (pr.yearlyBest || pr.yearlyPrice) : (pr.monthlyBest || pr.monthlyPrice))
      : 0;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { paymentMode: true } });
    const mode = tenant?.paymentMode === 'AUTO' ? 'AUTO' : 'MANUAL';

    const req = await this.prisma.planUpgradeRequest.create({
      data: { tenantId: user.tenantId, clientId: client.id, requestedPlan: plan.name, currency, period, amount, mode, status: 'PENDING' },
    });

    if (mode === 'AUTO') {
      const order = await this.cashfree.createOrder({
        requestId: req.id, amount, currency: currency ?? 'USD',
        customer: { name: client.name, email: client.email ?? undefined, phone: client.mobile ?? undefined },
        returnUrl: `${this.config.get('APP_PUBLIC_URL', 'http://localhost:4000')}/pricing?paid=${req.id}`,
      });
      if (order.orderId) await this.prisma.planUpgradeRequest.update({ where: { id: req.id }, data: { paymentRef: order.orderId } });
      return { mode, requestId: req.id, paymentLink: order.paymentLink ?? null, amount, currency };
    }
    return { mode, requestId: req.id, paymentLink: null, amount, currency };
  }

  // ── admin: list requests (with client details + filters) ─────────────
  async listRequests(user: AuthUser, query: { status?: string; q?: string; page?: string; pageSize?: string }) {
    this.assertAdmin(user);
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '25', 10) || 25));
    const ci = (c: string) => ({ contains: c, mode: 'insensitive' as const });

    let clientIds: string[] | undefined;
    const q = query.q?.trim();
    if (q) {
      const clients = await this.prisma.client.findMany({
        where: { tenantId: user.tenantId, OR: [{ name: ci(q) }, { productCategory: ci(q) }, { invoiceNo: ci(q) }, { email: ci(q) }, { mobile: ci(q) }] },
        select: { id: true },
      });
      clientIds = clients.map((c) => c.id);
      if (clientIds.length === 0) return { items: [], total: 0, page, pageSize };
    }
    const where = {
      tenantId: user.tenantId,
      ...(query.status ? { status: query.status.toUpperCase() } : {}),
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.planUpgradeRequest.count({ where }),
      this.prisma.planUpgradeRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const clients = await this.prisma.client.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } },
      select: { id: true, name: true, productCategory: true, invoiceNo: true, email: true, mobile: true },
    });
    const cmap = new Map(clients.map((c) => [c.id, c]));
    const items = rows.map((r) => {
      const c = cmap.get(r.clientId);
      return {
        id: r.id, requestedPlan: r.requestedPlan, currency: r.currency, period: r.period, amount: r.amount,
        mode: r.mode, status: r.status, createdAt: r.createdAt,
        client: c ? { id: c.id, name: c.name, company: c.productCategory, invoice: c.invoiceNo, email: c.email, mobile: c.mobile } : null,
      };
    });
    return { items, total, page, pageSize };
  }

  async activate(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const req = await this.prisma.planUpgradeRequest.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!req) throw new NotFoundException('Request not found');
    await this.applyPlanToClient(user.tenantId, req.clientId, req.requestedPlan, req.period);
    return this.prisma.planUpgradeRequest.update({ where: { id }, data: { status: 'ACTIVATED' } });
  }
  async reject(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const req = await this.prisma.planUpgradeRequest.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!req) throw new NotFoundException('Request not found');
    return this.prisma.planUpgradeRequest.update({ where: { id }, data: { status: 'REJECTED' } });
  }

  /** Apply a plan's entitlements to a client (used on activation / paid webhook). */
  private async applyPlanToClient(tenantId: string, clientId: string, planName: string, period = 'monthly') {
    const plan = await this.prisma.plan.findFirst({ where: { tenantId, name: planName } });
    if (!plan) throw new BadRequestException('Plan not found');
    // Per-period entitlements: base columns = monthly; yearlyEntitlements JSON
    // overrides them for yearly (falling back to the base value when unset).
    const ye = (plan.yearlyEntitlements ?? {}) as Record<string, number>;
    const pick = (key: string, base: number) =>
      period === 'yearly' && typeof ye[key] === 'number' ? ye[key] : base;
    const emailCredits = pick('emailCredits', plan.emailCredits);
    const mailboxLimit = pick('mailboxLimit', plan.mailboxLimit);
    const emailCampaignLimit = pick('emailCampaignLimit', plan.emailCampaignLimit);
    const seatLimit = pick('seatLimit', plan.seatLimit);
    const linkedInCredits = pick('linkedInCredits', plan.linkedInCredits);
    const linkedInCampaignLimit = pick('linkedInCampaignLimit', plan.linkedInCampaignLimit);
    // Monthly billing grants a 30-day window; yearly uses the plan's (period) validity.
    const validity = period === 'yearly' ? pick('validityDays', plan.validityDays ?? 0) : 30;
    await this.prisma.client.update({
      where: { id: clientId },
      data: {
        plan: plan.name,
        emailEnabled: plan.emailEnabled,
        linkedInEnabled: plan.linkedInEnabled,
        emailCredits,
        mailboxLimit,
        emailCampaignLimit,
        ...(validity > 0
          ? { validityDays: validity, validityStartAt: new Date(), validityNotifyStage: 0 }
          : {}),
      },
    });
    if (plan.linkedInEnabled) {
      await this.liSubs.update(tenantId, clientId, {
        planName: plan.name, seats: seatLimit || 1,
        creditsBalance: linkedInCredits, campaignLimit: linkedInCampaignLimit,
      });
    }
    // Log the subscription period for the renewal history.
    if (validity > 0) {
      const pricing = (plan.pricing ?? []) as unknown as PricingRow[];
      const row = pricing[0];
      const amount = row ? (period === 'yearly' ? row.yearlyPrice : row.monthlyPrice) : undefined;
      await this.subscriptions.record(tenantId, clientId, {
        plan: plan.name, validityDays: validity, amount: amount ?? null, currency: row?.currency ?? null, source: 'billing',
      });
    }
  }

  // ── Cashfree webhook (public) ────────────────────────────────────────
  async cashfreeWebhook(headers: Record<string, unknown>, rawBody: string, payload: any) {
    if (!this.cashfree.verifyWebhook(headers, rawBody)) return { ok: false };
    const orderId = payload?.data?.order?.order_id ?? payload?.order_id;
    const paid = (payload?.data?.payment?.payment_status ?? payload?.txStatus) === 'SUCCESS';
    if (!orderId || !paid) return { ok: true, ignored: true };
    const req = await this.prisma.planUpgradeRequest.findFirst({ where: { paymentRef: orderId } });
    if (!req || req.status === 'ACTIVATED') return { ok: true };
    await this.applyPlanToClient(req.tenantId, req.clientId, req.requestedPlan, req.period);
    await this.prisma.planUpgradeRequest.update({ where: { id: req.id }, data: { status: 'ACTIVATED' } });
    return { ok: true };
  }
}
