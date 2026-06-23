import { Injectable, NotFoundException } from '@nestjs/common';
import { SuppressionReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class ComplianceService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  // ── Suppression list ──────────────────────────────────────
  listSuppression(tenantId: string) {
    return this.prisma.suppression.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  addSuppression(tenantId: string, email: string, reason: SuppressionReason) {
    return this.prisma.suppression.upsert({
      where: { tenantId_email: { tenantId, email: email.toLowerCase() } },
      update: { reason },
      create: { tenantId, email: email.toLowerCase(), reason },
    });
  }

  async removeSuppression(tenantId: string, id: string) {
    const row = await this.prisma.suppression.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Suppression entry not found');
    await this.prisma.suppression.delete({ where: { id } });
    return { success: true };
  }

  // ── GDPR data portability ─────────────────────────────────
  /** Returns everything held about a contact (right to access / portability). */
  async exportContact(user: AuthUser, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId: user.tenantId },
      include: {
        lists: { include: { list: { select: { name: true } } } },
        messages: {
          select: {
            id: true,
            subject: true,
            direction: true,
            status: true,
            sentAt: true,
            createdAt: true,
            events: { select: { eventType: true, occurredAt: true } },
          },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'GDPR_EXPORT',
      entityType: 'Contact',
      entityId: contactId,
    });
    return {
      exportedAt: new Date().toISOString(),
      subject: {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        country: contact.country,
        customFields: contact.customFields,
        status: contact.status,
      },
      lists: contact.lists.map((l) => l.list.name),
      messages: contact.messages,
    };
  }

  /** Right to erasure: scrub PII, suppress the address, keep an audit marker. */
  async eraseContact(user: AuthUser, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenantId: user.tenantId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    await this.prisma.$transaction([
      this.prisma.suppression.upsert({
        where: {
          tenantId_email: { tenantId: user.tenantId, email: contact.email },
        },
        update: { reason: SuppressionReason.MANUAL },
        create: {
          tenantId: user.tenantId,
          email: contact.email,
          reason: SuppressionReason.MANUAL,
        },
      }),
      this.prisma.contact.update({
        where: { id: contactId },
        data: {
          firstName: null,
          lastName: null,
          company: null,
          country: null,
          customFields: {},
          email: `erased+${contact.id}@redacted.invalid`,
          status: 'UNSUBSCRIBED',
        },
      }),
    ]);

    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'GDPR_ERASE',
      entityType: 'Contact',
      entityId: contactId,
    });
    return { success: true, erased: contactId };
  }
}
