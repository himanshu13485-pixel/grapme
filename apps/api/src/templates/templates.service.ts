import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalEntity,
  ApprovalStatus,
  Role,
  TemplateStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resourceClientScope } from '../common/client-scope';
import { UpsertTemplateDto } from './templates.controller';

/** Pulls {{variable}} tokens out of subject + body for the builder UI. */
export function extractVariables(...parts: string[]): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  for (const part of parts) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(part ?? '')) !== null) found.add(m[1]);
  }
  return [...found];
}

/** Renders a template against a contact's fields. Unknown tokens blank out. */
export function renderTemplate(
  text: string,
  data: Record<string, unknown>,
): string {
  return (text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = data?.[key];
    return value == null ? '' : String(value);
  });
}

@Injectable()
export class TemplatesService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
  ) {}

  async list(user: AuthUser, clientId?: string) {
    const scope = await resourceClientScope(this.prisma, user, clientId);
    return this.prisma.emailTemplate.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
      },
      orderBy: { updatedAt: 'desc' },
      include: { client: { select: { id: true, name: true } } },
    });
  }

  async getOne(user: AuthUser, id: string) {
    // Same scope as list(): a client-portal user can only reach templates of a
    // workspace they own, so another client's template can't be read, edited
    // or deleted by guessing its id.
    const scope = await resourceClientScope(this.prisma, user);
    const tpl = await this.prisma.emailTemplate.findFirst({
      where: { id, tenantId: user.tenantId, ...scope },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return tpl;
  }

  /**
   * A template written in the client portal is created PENDING and queued for
   * admin/sub-admin review; it can't be sent until approved. Staff-authored
   * templates go live immediately, as before.
   */
  async create(user: AuthUser, dto: UpsertTemplateDto) {
    const clientId = await this.writableClientId(user, dto.clientId);
    const needsReview = user.role === Role.CLIENT;
    const tpl = await this.prisma.emailTemplate.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        clientId,
        variables: extractVariables(dto.subject, dto.bodyHtml),
        status: needsReview ? TemplateStatus.PENDING : TemplateStatus.APPROVED,
      },
    });
    if (needsReview) await this.requestReview(user, tpl.id);
    return tpl;
  }

  /**
   * When a client changes what a template actually says (subject or body), it
   * goes back to PENDING for review — otherwise an approved template could be
   * rewritten and sent unreviewed. Renaming alone doesn't need review. Staff
   * edits leave the review state as it is; approving stays an explicit action
   * on the Approvals page.
   */
  async update(user: AuthUser, id: string, dto: UpsertTemplateDto) {
    const before = await this.getOne(user, id);
    const isClient = user.role === Role.CLIENT;
    const contentChanged =
      before.subject !== dto.subject ||
      before.bodyHtml !== dto.bodyHtml ||
      (dto.bodyText !== undefined && (before.bodyText ?? '') !== (dto.bodyText ?? ''));
    const resubmit = isClient && contentChanged;

    const clientPatch =
      dto.clientId !== undefined
        ? { clientId: await this.writableClientId(user, dto.clientId) }
        : {};

    const tpl = await this.prisma.emailTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        variables: extractVariables(dto.subject, dto.bodyHtml),
        ...clientPatch,
        ...(resubmit ? { status: TemplateStatus.PENDING, reviewNote: null } : {}),
      },
    });
    if (resubmit) await this.requestReview(user, id);
    return tpl;
  }

  /** Open a review for a template unless one is already waiting. */
  private async requestReview(user: AuthUser, templateId: string) {
    const open = await this.prisma.approval.findFirst({
      where: {
        tenantId: user.tenantId,
        entityType: ApprovalEntity.TEMPLATE,
        entityId: templateId,
        status: ApprovalStatus.PENDING,
      },
      select: { id: true },
    });
    if (open) return;
    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.TEMPLATE,
      entityId: templateId,
    });
  }

  /**
   * The client a template may be saved against. Staff can pick any client (or
   * none, for a shared template). A client-portal user can only save into a
   * workspace they own — and must, since a client can't own a shared template.
   */
  private async writableClientId(
    user: AuthUser,
    clientId?: string,
  ): Promise<string | null> {
    if (user.role !== Role.CLIENT) return clientId || null;
    const owned = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true },
    });
    const ids = owned.map((c) => c.id);
    if (clientId && ids.includes(clientId)) return clientId;
    if (!clientId && ids.length === 1) return ids[0];
    throw new BadRequestException('Choose one of your workspaces for this template.');
  }

  /** Delete a template, first detaching it from anything that points at it
   *  (campaigns, campaign steps, sequence steps) so the FK never blocks it. */
  async remove(user: AuthUser, id: string) {
    await this.getOne(user, id);
    await this.prisma.$transaction([
      // Close any review still waiting on this template so it doesn't linger
      // in the Approvals queue pointing at nothing.
      this.prisma.approval.updateMany({
        where: {
          tenantId: user.tenantId,
          entityType: ApprovalEntity.TEMPLATE,
          entityId: id,
          status: ApprovalStatus.PENDING,
        },
        data: {
          status: ApprovalStatus.REJECTED,
          decisionReason: 'Template deleted before review',
          decidedAt: new Date(),
        },
      }),
      this.prisma.campaign.updateMany({
        where: { templateId: id, tenantId: user.tenantId },
        data: { templateId: null },
      }),
      this.prisma.campaignStep.updateMany({
        where: { templateId: id },
        data: { templateId: null },
      }),
      this.prisma.sequenceStep.updateMany({
        where: { templateId: id },
        data: { templateId: null },
      }),
      this.prisma.emailTemplate.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  /** Basic deliverability lint surfaced in the builder. */
  async spamCheck(user: AuthUser, id: string) {
    const tpl = await this.getOne(user, id);
    const body = `${tpl.subject} ${tpl.bodyHtml}`.toLowerCase();
    const triggers = ['free', 'guarantee', 'act now', 'winner', '100%', '$$$'];
    const hits = triggers.filter((t) => body.includes(t));
    const linkCount = (tpl.bodyHtml.match(/href=/gi) ?? []).length;
    const hasUnsub = /unsubscribe/i.test(tpl.bodyHtml);

    let score = 100;
    score -= hits.length * 8;
    if (linkCount > 5) score -= 15;
    if (!hasUnsub) score -= 20;

    return {
      score: Math.max(0, score),
      spamTriggerWords: hits,
      linkCount,
      hasUnsubscribe: hasUnsub,
      advice: hasUnsub
        ? 'Looks reasonable.'
        : 'Add an unsubscribe link (required for CAN-SPAM/GDPR compliance).',
    };
  }
}
