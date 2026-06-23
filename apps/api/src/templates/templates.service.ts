import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
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
  constructor(private prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.emailTemplate.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const tpl = await this.prisma.emailTemplate.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!tpl) throw new NotFoundException('Template not found');
    return tpl;
  }

  create(user: AuthUser, dto: UpsertTemplateDto) {
    return this.prisma.emailTemplate.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        variables: extractVariables(dto.subject, dto.bodyHtml),
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpsertTemplateDto) {
    await this.getOne(user, id);
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        variables: extractVariables(dto.subject, dto.bodyHtml),
      },
    });
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
