import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalEntity,
  ApprovalStatus,
  CampaignStatus,
  ImportStatus,
  MailboxStatus,
  Role,
  ScheduleStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ListApprovalsQuery } from './dto/approvals.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
  ) {}

  /** Called by other modules when a user submits an entity for review. */
  async submit(params: {
    tenantId: string;
    submittedById: string;
    entityType: ApprovalEntity;
    entityId: string;
  }) {
    const approval = await this.prisma.approval.create({
      data: {
        tenantId: params.tenantId,
        entityType: params.entityType,
        entityId: params.entityId,
        submittedById: params.submittedById,
        status: ApprovalStatus.PENDING,
      },
    });
    await this.activity.log({
      tenantId: params.tenantId,
      actorId: params.submittedById,
      action: 'SUBMIT_FOR_APPROVAL',
      entityType: params.entityType,
      entityId: params.entityId,
    });
    return approval;
  }

  async list(reviewer: AuthUser, query: ListApprovalsQuery) {
    // A sub-admin only reviews items submitted by their assigned users.
    let submitterFilter = {};
    if (reviewer.role === Role.SUB_ADMIN) {
      const rows = await this.prisma.subAdminAssignment.findMany({
        where: { subAdminId: reviewer.userId, assignedUserId: { not: null } },
        select: { assignedUserId: true },
      });
      submitterFilter = { submittedById: { in: rows.map((r) => r.assignedUserId!) } };
    }
    const approvals = await this.prisma.approval.findMany({
      where: {
        tenantId: reviewer.tenantId,
        status: query.status,
        entityType: query.entityType,
        ...submitterFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewer: { select: { name: true, email: true } },
      },
    });
    const targets = await this.resolveTargets(approvals);
    const meta = await this.resolveTargets(approvals);
    return approvals.map((a) => ({
      ...a,
      target: meta.get(a.id)?.target ?? null,
      clientName: meta.get(a.id)?.clientName ?? null,
    }));
  }

  /** Human "what" label + owning client name per approval. */
  private async resolveTargets(
    approvals: { id: string; entityType: ApprovalEntity; entityId: string }[],
  ): Promise<Map<string, { target?: string; clientName?: string }>> {
    const out = new Map<string, { target?: string; clientName?: string }>();
    const idsOf = (t: ApprovalEntity) =>
      approvals.filter((a) => a.entityType === t).map((a) => a.entityId);

    const [mailboxes, imports, campaigns, schedules, messages] = await Promise.all([
      this.prisma.emailAccount.findMany({
        where: { id: { in: idsOf(ApprovalEntity.SMTP) } },
        select: { id: true, label: true, emailAddress: true, clientId: true },
      }),
      this.prisma.importJob.findMany({
        where: { id: { in: idsOf(ApprovalEntity.IMPORT) } },
        select: { id: true, filename: true, validRows: true, clientId: true },
      }),
      this.prisma.campaign.findMany({
        where: {
          id: {
            in: [
              ...idsOf(ApprovalEntity.CAMPAIGN),
              ...idsOf(ApprovalEntity.SEQUENCE),
            ],
          },
        },
        select: { id: true, name: true, clientId: true },
      }),
      this.prisma.schedule.findMany({
        where: { id: { in: idsOf(ApprovalEntity.SCHEDULE) } },
        select: {
          id: true,
          campaign: { select: { name: true, clientId: true } },
        },
      }),
      this.prisma.emailMessage.findMany({
        where: { id: { in: idsOf(ApprovalEntity.MESSAGE_DELETE) } },
        select: {
          id: true,
          subject: true,
          fromAddress: true,
          direction: true,
          emailAccount: { select: { clientId: true } },
        },
      }),
    ]);

    // Resolve every referenced clientId to a name in one query.
    const clientIds = new Set<string>(idsOf(ApprovalEntity.CLIENT_DELETE));
    mailboxes.forEach((m) => m.clientId && clientIds.add(m.clientId));
    imports.forEach((j) => j.clientId && clientIds.add(j.clientId));
    campaigns.forEach((c) => c.clientId && clientIds.add(c.clientId));
    schedules.forEach((s) => s.campaign?.clientId && clientIds.add(s.campaign.clientId));
    messages.forEach((m) => m.emailAccount?.clientId && clientIds.add(m.emailAccount.clientId));
    const clientRows = await this.prisma.client.findMany({
      where: { id: { in: [...clientIds] } },
      select: { id: true, name: true },
    });
    const clientName = new Map(clientRows.map((c) => [c.id, c.name]));

    const mb = new Map(
      mailboxes.map((m) => [
        m.id,
        {
          target: m.label ? `${m.label} (${m.emailAddress})` : m.emailAddress,
          clientName: m.clientId ? clientName.get(m.clientId) : undefined,
        },
      ]),
    );
    const im = new Map(
      imports.map((j) => [
        j.id,
        {
          target: `${j.filename} · ${j.validRows} rows`,
          clientName: j.clientId ? clientName.get(j.clientId) : undefined,
        },
      ]),
    );
    const cp = new Map(
      campaigns.map((c) => [
        c.id,
        { name: c.name, clientName: c.clientId ? clientName.get(c.clientId) : undefined },
      ]),
    );
    const sc = new Map(
      schedules.map((s) => [
        s.id,
        {
          name: s.campaign?.name ?? 'campaign',
          clientName: s.campaign?.clientId ? clientName.get(s.campaign.clientId) : undefined,
        },
      ]),
    );
    const mg = new Map(
      messages.map((m) => [
        m.id,
        {
          target: `Delete ${m.direction === 'INBOUND' ? 'inbound' : 'sent'}: ${m.subject || m.fromAddress || 'message'}`,
          clientName: m.emailAccount?.clientId ? clientName.get(m.emailAccount.clientId) : undefined,
        },
      ]),
    );

    for (const a of approvals) {
      switch (a.entityType) {
        case ApprovalEntity.SMTP:
          if (mb.has(a.entityId)) out.set(a.id, mb.get(a.entityId)!);
          break;
        case ApprovalEntity.IMPORT:
          if (im.has(a.entityId)) out.set(a.id, im.get(a.entityId)!);
          break;
        case ApprovalEntity.CAMPAIGN: {
          const c = cp.get(a.entityId);
          if (c) out.set(a.id, { target: c.name, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.SEQUENCE: {
          const c = cp.get(a.entityId);
          if (c) out.set(a.id, { target: `Sequence · ${c.name}`, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.SCHEDULE: {
          const s = sc.get(a.entityId);
          if (s) out.set(a.id, { target: `Schedule · ${s.name}`, clientName: s.clientName });
          break;
        }
        case ApprovalEntity.MESSAGE_DELETE:
          if (mg.has(a.entityId)) out.set(a.id, mg.get(a.entityId)!);
          break;
        case ApprovalEntity.CLIENT_DELETE: {
          const n = clientName.get(a.entityId);
          if (n) out.set(a.id, { target: `Delete client: ${n}`, clientName: n });
          break;
        }
      }
    }
    return out;
  }

  async approve(reviewer: AuthUser, approvalId: string) {
    const approval = await this.getPending(reviewer.tenantId, approvalId);
    await this.transitionEntity(approval.entityType, approval.entityId, true);
    return this.finalize(reviewer, approvalId, ApprovalStatus.APPROVED);
  }

  async reject(reviewer: AuthUser, approvalId: string, reason: string) {
    const approval = await this.getPending(reviewer.tenantId, approvalId);
    await this.transitionEntity(approval.entityType, approval.entityId, false);
    return this.finalize(reviewer, approvalId, ApprovalStatus.REJECTED, reason);
  }

  private async getPending(tenantId: string, approvalId: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, tenantId, status: ApprovalStatus.PENDING },
    });
    if (!approval) throw new NotFoundException('Pending approval not found');
    return approval;
  }

  private async finalize(
    reviewer: AuthUser,
    approvalId: string,
    status: ApprovalStatus,
    reason?: string,
  ) {
    const updated = await this.prisma.approval.update({
      where: { id: approvalId },
      data: {
        status,
        reviewerId: reviewer.userId,
        decisionReason: reason,
        decidedAt: new Date(),
      },
    });
    await this.activity.log({
      tenantId: reviewer.tenantId,
      actorId: reviewer.userId,
      action: status === ApprovalStatus.APPROVED ? 'APPROVE' : 'REJECT',
      entityType: updated.entityType,
      entityId: updated.entityId,
      after: { reason },
    });
    return updated;
  }

  /**
   * Drives the linked entity into its post-decision state.
   * This is the gate: entities only become active here, never from the user API.
   */
  private async transitionEntity(
    entityType: ApprovalEntity,
    entityId: string,
    approved: boolean,
  ) {
    switch (entityType) {
      case ApprovalEntity.CAMPAIGN:
        await this.prisma.campaign.update({
          where: { id: entityId },
          data: {
            status: approved
              ? CampaignStatus.APPROVED
              : CampaignStatus.REJECTED,
          },
        });
        break;
      case ApprovalEntity.SMTP:
        await this.prisma.emailAccount.update({
          where: { id: entityId },
          data: {
            status: approved ? MailboxStatus.ACTIVE : MailboxStatus.DISABLED,
          },
        });
        break;
      case ApprovalEntity.IMPORT:
        if (approved) {
          await this.processImport(entityId);
        } else {
          await this.prisma.importJob.update({
            where: { id: entityId },
            data: { status: ImportStatus.REJECTED },
          });
        }
        break;
      case ApprovalEntity.SCHEDULE:
        await this.prisma.schedule.update({
          where: { id: entityId },
          data: {
            status: approved ? ScheduleStatus.APPROVED : ScheduleStatus.PENDING,
          },
        });
        break;
      case ApprovalEntity.SEQUENCE:
        // Sequences live on the campaign; approval is recorded but no
        // entity-level flag is flipped here.
        break;
      case ApprovalEntity.MESSAGE_DELETE:
        // Approve = carry out the requested deletion; reject = keep the message.
        if (approved) {
          await this.prisma.emailMessage.deleteMany({ where: { id: entityId } });
        }
        break;
      case ApprovalEntity.CLIENT_DELETE:
        // Approve = delete the client (cohorts/sequences/enrollments cascade;
        // mailboxes/contacts/lists/templates/campaigns are kept + unlinked).
        if (approved) {
          await this.prisma.client.deleteMany({ where: { id: entityId } });
        }
        break;
    }
  }

  /** Inserts the staged rows of an approved import (deduped per tenant). */
  private async processImport(importJobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: importJobId },
    });
    if (!job) return;

    const rows = (job.payload as Array<Record<string, string>>) ?? [];
    for (const row of rows) {
      const hash = createHash('sha256')
        .update((row.email ?? '').trim().toLowerCase())
        .digest('hex');

      const contact = await this.prisma.contact.upsert({
        where: { tenantId_dedupeHash: { tenantId: job.tenantId, dedupeHash: hash } },
        update: {
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          country: row.country,
        },
        create: {
          tenantId: job.tenantId,
          userId: job.userId,
          email: row.email,
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          country: row.country,
          clientId: job.clientId,
          dedupeHash: hash,
        },
      });

      if (job.listId) {
        await this.prisma.contactListMember.upsert({
          where: {
            listId_contactId: { listId: job.listId, contactId: contact.id },
          },
          update: {},
          create: { listId: job.listId, contactId: contact.id },
        });
      }
    }

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: ImportStatus.DONE },
    });
  }
}
