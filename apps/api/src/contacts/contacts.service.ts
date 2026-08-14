import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalEntity } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resourceClientScope } from '../common/client-scope';
import {
  CreateContactDto,
  CreateListDto,
  ImportContactsDto,
  UpdateContactDto,
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
  async list(user: AuthUser, clientId?: string) {
    const scope = await resourceClientScope(this.prisma, user, clientId);
    const contacts = await this.prisma.contact.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        lists: { select: { listId: true } },
        client: { select: { id: true, name: true } },
      },
    });
    // Flatten memberships into a listIds array the UI can prefill from.
    return contacts.map(({ lists, ...c }) => ({
      ...c,
      listIds: lists.map((l) => l.listId),
    }));
  }

  /** Manual single add — immediately active, optionally added to a list. */
  async create(user: AuthUser, dto: CreateContactDto) {
    const { listId, ...fields } = dto;

    const contact = await this.prisma.contact.upsert({
      where: {
        tenantId_dedupeHash: {
          tenantId: user.tenantId,
          dedupeHash: dedupeHash(dto.email),
        },
      },
      update: {
        email: fields.email,
        firstName: fields.firstName,
        lastName: fields.lastName,
        company: fields.company,
        country: fields.country,
      },
      create: {
        tenantId: user.tenantId,
        userId: user.userId,
        email: fields.email,
        firstName: fields.firstName,
        lastName: fields.lastName,
        company: fields.company,
        country: fields.country,
        clientId: fields.clientId || null,
        dedupeHash: dedupeHash(dto.email),
      },
    });

    // Optionally attach to an existing list (idempotent).
    if (listId) {
      const list = await this.prisma.contactList.findFirst({
        where: { id: listId, tenantId: user.tenantId },
      });
      if (!list) throw new NotFoundException('List not found');
      await this.prisma.contactListMember.upsert({
        where: { listId_contactId: { listId, contactId: contact.id } },
        update: {},
        create: { listId, contactId: contact.id },
      });
    }

    return contact;
  }

  /** Edit an existing contact's fields, status, and list memberships. */
  async update(user: AuthUser, id: string, dto: UpdateContactDto) {
    const existing = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Contact not found');

    const data: Record<string, unknown> = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      company: dto.company,
      country: dto.country,
    };
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.clientId !== undefined) data.clientId = dto.clientId || null;

    // Changing the email changes the dedupe hash — guard against collisions.
    if (
      dto.email !== undefined &&
      dedupeHash(dto.email) !== existing.dedupeHash
    ) {
      const newHash = dedupeHash(dto.email);
      const clash = await this.prisma.contact.findFirst({
        where: { tenantId: user.tenantId, dedupeHash: newHash, NOT: { id } },
      });
      if (clash) {
        throw new BadRequestException(
          'Another contact already uses that email',
        );
      }
      data.email = dto.email;
      data.dedupeHash = newHash;
    }

    const contact = await this.prisma.contact.update({
      where: { id },
      data,
    });

    // Sync list memberships to exactly match listIds (when provided).
    if (dto.listIds) {
      const valid = await this.prisma.contactList.findMany({
        where: { id: { in: dto.listIds }, tenantId: user.tenantId },
        select: { id: true },
      });
      const desired = valid.map((v) => v.id);
      await this.prisma.contactListMember.deleteMany({
        where: { contactId: id, listId: { notIn: desired } },
      });
      for (const listId of desired) {
        await this.prisma.contactListMember.upsert({
          where: { listId_contactId: { listId, contactId: id } },
          update: {},
          create: { listId, contactId: id },
        });
      }
    }

    return contact;
  }

  /** Permanently delete a contact (memberships cascade). */
  async remove(user: AuthUser, id: string) {
    const existing = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    await this.prisma.contact.delete({ where: { id } });
    return { ok: true };
  }

  /** Bulk-delete contacts (scoped to the caller's tenant). Returns how many were removed. */
  async removeMany(user: AuthUser, ids: string[]) {
    const clean = [...new Set((ids ?? []).filter(Boolean))];
    if (clean.length === 0) return { ok: true, deleted: 0 };
    const res = await this.prisma.contact.deleteMany({
      where: { id: { in: clean }, tenantId: user.tenantId },
    });
    return { ok: true, deleted: res.count };
  }

  // ── Lists ─────────────────────────────────────────────────
  async listLists(user: AuthUser, clientId?: string) {
    const scope = await resourceClientScope(this.prisma, user, clientId);
    return this.prisma.contactList.findMany({
      where: {
        tenantId: user.tenantId,
        ...scope,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true } },
        client: { select: { id: true, name: true } },
      },
    });
  }

  createList(user: AuthUser, dto: CreateListDto) {
    return this.prisma.contactList.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        name: dto.name,
        description: dto.description,
        clientId: dto.clientId || null,
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

    // Owning client: explicit, else inherit from the target list's client.
    let clientId = dto.clientId || null;
    if (!clientId && dto.listId) {
      const list = await this.prisma.contactList.findFirst({
        where: { id: dto.listId, tenantId: user.tenantId },
        select: { clientId: true },
      });
      clientId = list?.clientId ?? null;
    }

    const job = await this.prisma.importJob.create({
      data: {
        tenantId: user.tenantId,
        userId: user.userId,
        filename: dto.filename,
        listId: dto.listId,
        clientId,
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

  /** Delete a list (its membership rows cascade; contacts are untouched). */
  async removeList(user: AuthUser, id: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!list) throw new NotFoundException('List not found');
    await this.prisma.contactList.delete({ where: { id } });
    return { ok: true };
  }

  /** Add existing contacts to a list (idempotent). */
  async addMembers(user: AuthUser, listId: string, contactIds: string[]) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenantId: user.tenantId },
    });
    if (!list) throw new NotFoundException('List not found');

    const valid = await this.prisma.contact.findMany({
      where: { id: { in: contactIds }, tenantId: user.tenantId },
      select: { id: true },
    });
    for (const c of valid) {
      await this.prisma.contactListMember.upsert({
        where: { listId_contactId: { listId, contactId: c.id } },
        update: {},
        create: { listId, contactId: c.id },
      });
    }
    return { added: valid.length };
  }

  /** Remove contacts from a list. */
  async removeMembers(user: AuthUser, listId: string, contactIds: string[]) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenantId: user.tenantId },
    });
    if (!list) throw new NotFoundException('List not found');

    const res = await this.prisma.contactListMember.deleteMany({
      where: { listId, contactId: { in: contactIds } },
    });
    return { removed: res.count };
  }

  /**
   * List hygiene: remove members whose address is suppressed (bounced /
   * unsubscribed / manually suppressed) or whose contact status is BOUNCED /
   * UNSUBSCRIBED. The contacts themselves are kept (for audit); only their
   * membership in this list is removed.
   */
  async cleanList(user: AuthUser, listId: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenantId: user.tenantId },
    });
    if (!list) throw new NotFoundException('List not found');

    const suppressed = new Set(
      (
        await this.prisma.suppression.findMany({
          where: { tenantId: user.tenantId },
          select: { email: true },
        })
      ).map((s) => s.email.toLowerCase()),
    );

    const members = await this.prisma.contactListMember.findMany({
      where: { listId },
      select: { contactId: true, contact: { select: { email: true, status: true } } },
    });
    const toRemove = members
      .filter(
        (m) =>
          m.contact.status === 'BOUNCED' ||
          m.contact.status === 'UNSUBSCRIBED' ||
          suppressed.has(m.contact.email.toLowerCase()),
      )
      .map((m) => m.contactId);

    if (toRemove.length === 0) return { removed: 0 };
    const res = await this.prisma.contactListMember.deleteMany({
      where: { listId, contactId: { in: toRemove } },
    });
    return { removed: res.count };
  }
}
