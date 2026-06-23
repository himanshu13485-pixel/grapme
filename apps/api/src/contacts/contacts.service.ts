import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalEntity } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  CreateContactDto,
  CreateListDto,
  ImportContactsDto,
} from './dto/contacts.dto';

export function dedupeHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private activity: ActivityService,
  ) {}

  // ── Contacts ──────────────────────────────────────────────
  list(user: AuthUser) {
    return this.prisma.contact.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** Manual single add — immediately active. */
  create(user: AuthUser, dto: CreateContactDto) {
    return this.prisma.contact.upsert({
      where: {
        tenantId_dedupeHash: {
          tenantId: user.tenantId,
          dedupeHash: dedupeHash(dto.email),
        },
      },
      update: { ...dto },
      create: {
        tenantId: user.tenantId,
        userId: user.userId,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        country: dto.country,
        dedupeHash: dedupeHash(dto.email),
      },
    });
  }

  // ── Lists ─────────────────────────────────────────────────
  listLists(user: AuthUser) {
    return this.prisma.contactList.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true } } },
    });
  }

  createList(user: AuthUser, dto: CreateListDto) {
    return this.prisma.contactList.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  // ── Bulk import (staged until approved) ───────────────────
  async import(user: AuthUser, dto: ImportContactsDto) {
    // Dedupe within the payload and report duplicates.
    const seen = new Set<string>();
    const unique: typeof dto.rows = [];
    let dupRows = 0;
    for (const row of dto.rows) {
      const h = dedupeHash(row.email);
      if (seen.has(h)) {
        dupRows++;
        continue;
      }
      seen.add(h);
      unique.push(row);
    }

    const job = await this.prisma.importJob.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        filename: dto.filename,
        listId: dto.listId,
        totalRows: dto.rows.length,
        validRows: unique.length,
        dupRows,
        payload: unique as object,
      },
    });

    await this.approvals.submit({
      tenantId: user.tenantId,
      submittedById: user.userId,
      entityType: ApprovalEntity.IMPORT,
      entityId: job.id,
    });
    await this.activity.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'IMPORT_CONTACTS',
      entityType: 'ImportJob',
      entityId: job.id,
      after: { total: dto.rows.length, valid: unique.length, dupRows },
    });

    return {
      importJobId: job.id,
      status: job.status,
      totalRows: job.totalRows,
      validRows: job.validRows,
      dupRows: job.dupRows,
      message: 'Import staged. Contacts insert once an admin approves.',
    };
  }

  listImports(user: AuthUser) {
    return this.prisma.importJob.findMany({
      where: { tenantId: user.tenantId, userId: user.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        filename: true,
        totalRows: true,
        validRows: true,
        dupRows: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async getList(user: AuthUser, id: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { members: { include: { contact: true } } },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }
}
