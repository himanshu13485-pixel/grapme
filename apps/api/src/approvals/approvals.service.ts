import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalEntity,
  ApprovalStatus,
  CampaignStatus,
  ImportStatus,
  LiCampaignStatus,
  MailboxStatus,
  Prisma,
  Role,
  ScheduleStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { LiCampaignsService } from '../linkedin/campaigns/li-campaigns.service';
import { ListApprovalsQuery } from './dto/approvals.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private prisma: PrismaService,
    private activity: ActivityService,
    private liCampaigns: LiCampaignsService,
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
    // A sub-admin reviews items submitted by their assigned users — plus
    // anything submitted by a client-portal user (activations and any profile
    // change a client makes). Client submissions aren't tied to an assigned
    // user, so they must reach every sub-admin who can review approvals.
    let scopeFilter = {};
    if (reviewer.role === Role.SUB_ADMIN) {
      const [rows, clientUsers] = await Promise.all([
        this.prisma.subAdminAssignment.findMany({
          where: { subAdminId: reviewer.userId, assignedUserId: { not: null } },
          select: { assignedUserId: true },
        }),
        this.prisma.user.findMany({
          where: { tenantId: reviewer.tenantId, role: Role.CLIENT },
          select: { id: true },
        }),
      ]);
      const submitterIds = [
        reviewer.userId, // their own submissions (e.g. a contact import they staged)
        ...rows.map((r) => r.assignedUserId!),
        ...clientUsers.map((u) => u.id),
      ];
      scopeFilter = { submittedById: { in: submitterIds } };
    }
    const approvals = await this.prisma.approval.findMany({
      where: {
        tenantId: reviewer.tenantId,
        status: query.status,
        entityType: query.entityType,
        ...scopeFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        reviewer: { select: { name: true, email: true } },
      },
    });
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

    const [mailboxes, imports, campaigns, schedules, messages, activations, liCampaigns] =
      await Promise.all([
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
      this.prisma.user.findMany({
        where: { id: { in: idsOf(ApprovalEntity.CLIENT_ACTIVATION) } },
        select: { id: true, name: true, email: true, companyName: true },
      }),
      this.prisma.liCampaign.findMany({
        where: { id: { in: idsOf(ApprovalEntity.LI_CAMPAIGN) } },
        select: { id: true, name: true, clientId: true },
      }),
    ]);

    // Login-email-change approvals reference the owner user; show the pending email.
    const loginEmailUsers = await this.prisma.user.findMany({
      where: { id: { in: idsOf(ApprovalEntity.CLIENT_LOGIN_EMAIL) } },
      select: { id: true, name: true, email: true, pendingEmail: true, companyName: true },
    });

    // Resolve every referenced clientId to a name in one query.
    const clientIds = new Set<string>([...idsOf(ApprovalEntity.CLIENT_DELETE), ...idsOf(ApprovalEntity.LI_CHANNEL_REQUEST)]);
    mailboxes.forEach((m) => m.clientId && clientIds.add(m.clientId));
    imports.forEach((j) => j.clientId && clientIds.add(j.clientId));
    campaigns.forEach((c) => c.clientId && clientIds.add(c.clientId));
    schedules.forEach((s) => s.campaign?.clientId && clientIds.add(s.campaign.clientId));
    messages.forEach((m) => m.emailAccount?.clientId && clientIds.add(m.emailAccount.clientId));
    liCampaigns.forEach((c) => c.clientId && clientIds.add(c.clientId));
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
    const ac = new Map(
      activations.map((u) => [
        u.id,
        {
          target: `Activate client login: ${u.name} (${u.email})`,
          clientName: u.companyName ?? u.name,
        },
      ]),
    );
    const lc = new Map(
      liCampaigns.map((c) => [
        c.id,
        { name: c.name, clientName: c.clientId ? clientName.get(c.clientId) : undefined },
      ]),
    );
    const le = new Map(
      loginEmailUsers.map((u) => [
        u.id,
        {
          target: `Change login email → ${u.pendingEmail ?? '(pending)'} (was ${u.email})`,
          clientName: u.companyName ?? u.name,
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
        case ApprovalEntity.CLIENT_ACTIVATION:
          if (ac.has(a.entityId)) out.set(a.id, ac.get(a.entityId)!);
          break;
        case ApprovalEntity.CLIENT_LOGIN_EMAIL:
          if (le.has(a.entityId)) out.set(a.id, le.get(a.entityId)!);
          break;
        case ApprovalEntity.LI_CAMPAIGN: {
          const c = lc.get(a.entityId);
          if (c) out.set(a.id, { target: `LinkedIn campaign · ${c.name}`, clientName: c.clientName });
          break;
        }
        case ApprovalEntity.LI_CHANNEL_REQUEST: {
          const n = clientName.get(a.entityId);
          out.set(a.id, { target: 'Enable LinkedIn channel', clientName: n });
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
    // updateMany (not update) so a decision on an approval whose entity was
    // already deleted finalizes cleanly instead of throwing a 500.
    switch (entityType) {
      case ApprovalEntity.CAMPAIGN:
        await this.prisma.campaign.updateMany({
          where: { id: entityId },
          data: {
            status: approved
              ? CampaignStatus.APPROVED
              : CampaignStatus.REJECTED,
          },
        });
        break;
      case ApprovalEntity.SMTP:
        await this.prisma.emailAccount.updateMany({
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
          await this.prisma.importJob.updateMany({
            where: { id: entityId },
            data: { status: ImportStatus.REJECTED },
          });
        }
        break;
      case ApprovalEntity.SCHEDULE:
        await this.prisma.schedule.updateMany({
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
      case ApprovalEntity.LI_CAMPAIGN:
        // Approve = launch the LinkedIn campaign (RUNNING + scheduler picks it up);
        // reject = leave it DRAFT so the client can edit and resubmit.
        if (approved) {
          const exists = await this.prisma.liCampaign.count({ where: { id: entityId } });
          if (exists) await this.liCampaigns.setStatus(entityId, LiCampaignStatus.RUNNING);
        }
        break;
      case ApprovalEntity.LI_CHANNEL_REQUEST:
        // Approve = turn the LinkedIn channel on for a client who requested it at
        // self-service setup; reject = leave it off (Email stays active either way).
        if (approved) {
          await this.prisma.client.updateMany({ where: { id: entityId }, data: { linkedInEnabled: true } });
        }
        break;
      case ApprovalEntity.CLIENT_ACTIVATION:
        // Approve = confirm the client's email so they can sign in; reject =
        // suspend the pending login so it can't be used.
        await this.prisma.user.updateMany({
          where: { id: entityId },
          data: approved
            ? {
                emailVerified: true,
                verifyTokenHash: null,
                verifyExpires: null,
                status: 'ACTIVE',
              }
            : { status: 'SUSPENDED' },
        });
        break;
      case ApprovalEntity.CLIENT_LOGIN_EMAIL: {
        // Fallback path (email not received): approve = apply the pending login email;
        // reject = discard it (current login stays unchanged).
        const u = await this.prisma.user.findFirst({ where: { id: entityId } });
        if (u?.pendingEmail && approved) {
          const clash = await this.prisma.user.findFirst({ where: { email: u.pendingEmail, id: { not: u.id } } });
          await this.prisma.user.update({
            where: { id: u.id },
            data: clash
              ? { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null }
              : { email: u.pendingEmail, emailVerified: true, pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null },
          });
        } else if (!approved) {
          await this.prisma.user.updateMany({
            where: { id: entityId },
            data: { pendingEmail: null, pendingEmailTokenHash: null, pendingEmailExpires: null },
          });
        }
        break;
      }
    }
  }

  /** Inserts the staged rows of an approved import (deduped per tenant). */
  private async processImport(importJobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: importJobId },
    });
    if (!job) return;

    const rows = (job.payload as Array<Record<string, string>>) ?? [];

    // The list being uploaded into (List-2), for the duplicate report.
    const newListName = job.listId
      ? (await this.prisma.contactList.findUnique({ where: { id: job.listId }, select: { name: true } }))?.name ?? null
      : null;
    const dupes: Prisma.DuplicateEmailCreateManyInput[] = [];

    for (const row of rows) {
      const hash = createHash('sha256')
        .update((row.email ?? '').trim().toLowerCase())
        .digest('hex');

      // Already in the tenant? Then this row is a duplicate (e.g. it already
      // lived in List-1). Record where it came from and where it already exists.
      const existing = await this.prisma.contact.findUnique({
        where: { tenantId_dedupeHash: { tenantId: job.tenantId, dedupeHash: hash } },
        select: {
          company: true,
          clientId: true,
          lists: { select: { list: { select: { name: true } } } },
        },
      });
      if (existing) {
        dupes.push({
          tenantId: job.tenantId,
          email: (row.email ?? '').trim(),
          fileName: job.filename,
          importJobId: job.id,
          newListId: job.listId,
          newListName,
          newCompany: row.company ?? null,
          existingListNames:
            existing.lists.map((l) => l.list.name).filter(Boolean).join(', ') || null,
          existingCompany: existing.company ?? null,
          existingClientId: existing.clientId ?? null,
        });
      }

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

    if (dupes.length) {
      await this.prisma.duplicateEmail.createMany({ data: dupes });
    }

    await this.prisma.importJob.update({
      where: { id: importJobId },
      data: { status: ImportStatus.DONE },
    });
  }
}
