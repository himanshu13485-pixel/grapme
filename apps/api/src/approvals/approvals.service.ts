import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalEntity,
  ApprovalStatus,
  CampaignStatus,
  ImportStatus,
  MailboxStatus,
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

  list(tenantId: string, query: ListApprovalsQuery) {
    return this.prisma.approval.findMany({
      where: {
        tenantId,
        status: query.status,
        entityType: query.entityType,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
      },
    });
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
