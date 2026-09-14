import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalEntity, ClientChangeKind, ImportStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ActivityService } from '../common/services/activity.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import {
  assertClientAccess,
  ownedClientIds,
  resourceClientScope,
} from '../common/client-scope';
import {
  CreateContactDto,
  CreateListDto,
  ImportContactsDto,
  UpdateContactDto,
} from './dto/contacts.dto';
import {
  checkContactCreate,
  checkContactUpdate,
  dedupeHash,
  writeContactCreate,
  writeContactUpdate,
} from './contact-writes.util';

export { dedupeHash };

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private activity: ActivityService,
  ) {}

  // ── Contacts ──────────────────────────────────────────────
  /** Keeps a client-portal user inside their own workspaces (staff: no restriction). */
  private async ownScope(user: AuthUser): Promise<Record<string, unknown>> {
    const ids = await ownedClientIds(this.prisma, user);
    return ids === null ? {} : { clientId: { in: ids } };
  }

  /** Hold a client-portal contact/list change for review; applied on approval. */
  private async requestChange(
    user: AuthUser,
    clientId: string,
    kind: ClientChangeKind,
    targetId: string | null,
    summary: string,
    lines: Array<string | null | undefined | false>,
    data: Record<string, unknown>,
  ) {
    const res = await this.approvals.submitClientChange({
      tenantId: user.tenantId,
      clientId,
      requestedById: user.userId,
      kind,
      targetId,
      summary,
      payload: JSON.parse(JSON.stringify({ lines: lines.filter((l): l is string => !!l), data })),
    });
    return {
      ok: true,
      pendingApproval: true,
      message: res.duplicate
        ? 'This request is already awaiting approval.'
        : 'Sent for approval. Nothing changes until our team approves it.',
    };
  }

  /** "a@x.com, b@y.com and 12 more" for review lines. */
  private emailSample(rows: { email: string }[]) {
    const shown = rows.slice(0, 10).map((r) => r.email).join(', ');
    return rows.length > 10 ? `${shown} and ${rows.length - 10} more` : shown;
  }

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

  /** Manual single add, optionally into a list. A client-portal add is held for
   *  review and written on approval. */
  async create(user: AuthUser, dto: CreateContactDto) {
    if (user.role !== Role.CLIENT) {
      return writeContactCreate(this.prisma, { tenantId: user.tenantId, userId: user.userId }, dto, null);
    }
    await assertClientAccess(this.prisma, user, dto.clientId);
    const own = (await ownedClientIds(this.prisma, user)) ?? [];
    await checkContactCreate(this.prisma, user.tenantId, dto, own);
    const list = dto.listId
      ? await this.prisma.contactList.findUnique({ where: { id: dto.listId }, select: { name: true } })
      : null;
    const name = [dto.firstName, dto.lastName].filter(Boolean).join(' ');
    return this.requestChange(
      user,
      dto.clientId as string,
      ClientChangeKind.CONTACT_CREATE,
      null,
      `Add contact · ${dto.email}`,
      [
        `Email: ${dto.email}`,
        name && `Name: ${name}`,
        dto.company && `Company: ${dto.company}`,
        dto.country && `Country: ${dto.country}`,
        list && `Add to list: ${list.name}`,
      ],
      { ...dto },
    );
  }

  /** Edit an existing contact's fields, status, and list memberships. A
   *  client-portal edit is held for review and applied on approval. */
  async update(user: AuthUser, id: string, dto: UpdateContactDto) {
    if (user.role !== Role.CLIENT) {
      return writeContactUpdate(this.prisma, user.tenantId, id, dto, null);
    }
    const own = (await ownedClientIds(this.prisma, user)) ?? [];
    const existing = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId, clientId: { in: own } },
      include: { lists: { select: { list: { select: { id: true, name: true } } } } },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    await checkContactUpdate(this.prisma, user.tenantId, existing, dto, own);

    // Only what actually changes goes to the reviewer (the edit form resends every field).
    const lines: string[] = [];
    const before = existing as unknown as Record<string, unknown>;
    const after = dto as unknown as Record<string, unknown>;
    const FIELDS: [string, string][] = [
      ['email', 'Email'],
      ['firstName', 'First name'],
      ['lastName', 'Last name'],
      ['company', 'Company'],
      ['country', 'Country'],
      ['status', 'Status'],
    ];
    for (const [key, label] of FIELDS) {
      if (after[key] === undefined) continue;
      const from = String(before[key] ?? '');
      const to = String(after[key] ?? '');
      if (from !== to) lines.push(`${label}: ${from || '—'} → ${to || '—'}`);
    }
    if (dto.clientId !== undefined && (dto.clientId || null) !== existing.clientId) {
      lines.push('Move to another of your workspaces');
    }
    if (dto.listIds) {
      const current = new Map(existing.lists.map((l) => [l.list.id, l.list.name]));
      const wanted = await this.prisma.contactList.findMany({
        where: { id: { in: dto.listIds }, tenantId: user.tenantId, clientId: { in: own } },
        select: { id: true, name: true },
      });
      const added = wanted.filter((l) => !current.has(l.id)).map((l) => l.name);
      const removed = [...current].filter(([lid]) => !wanted.some((w) => w.id === lid)).map(([, n]) => n);
      if (added.length) lines.push(`Add to lists: ${added.join(', ')}`);
      if (removed.length) lines.push(`Remove from lists: ${removed.join(', ')}`);
    }
    if (lines.length === 0) return { ...existing, pendingApproval: false };
    return this.requestChange(
      user,
      existing.clientId as string,
      ClientChangeKind.CONTACT_UPDATE,
      id,
      `Edit contact · ${existing.email}`,
      [`Contact: ${existing.email}`, ...lines],
      { ...dto },
    );
  }

  /** Permanently delete a contact (memberships cascade). A client's delete is a request. */
  async remove(user: AuthUser, id: string) {
    const existing = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId, ...(await this.ownScope(user)) },
    });
    if (!existing) throw new NotFoundException('Contact not found');
    if (user.role === Role.CLIENT) {
      return this.requestChange(
        user,
        existing.clientId as string,
        ClientChangeKind.CONTACT_DELETE,
        id,
        `Delete contact · ${existing.email}`,
        [`Delete contact: ${existing.email}`],
        {},
      );
    }
    await this.prisma.contact.delete({ where: { id } });
    return { ok: true };
  }

  /** Bulk-delete contacts (scoped to the caller's tenant). Returns how many were removed. */
  async removeMany(user: AuthUser, ids: string[]) {
    const clean = [...new Set((ids ?? []).filter(Boolean))];
    if (clean.length === 0) return { ok: true, deleted: 0 };
    if (user.role === Role.CLIENT) {
      const rows = await this.prisma.contact.findMany({
        where: { id: { in: clean }, tenantId: user.tenantId, ...(await this.ownScope(user)) },
        select: { id: true, email: true, clientId: true },
      });
      if (rows.length === 0) return { ok: true, deleted: 0 };
      // One request per workspace, so each is reviewed and applied against its own client.
      const byClient = new Map<string, typeof rows>();
      for (const r of rows) {
        const key = r.clientId as string;
        byClient.set(key, [...(byClient.get(key) ?? []), r]);
      }
      for (const [clientId, group] of byClient) {
        await this.requestChange(
          user,
          clientId,
          ClientChangeKind.CONTACT_BULK_DELETE,
          null,
          `Delete ${group.length} contact${group.length === 1 ? '' : 's'}`,
          [`Delete: ${this.emailSample(group)}`],
          { ids: group.map((g) => g.id) },
        );
      }
      return {
        ok: true,
        deleted: 0,
        pendingApproval: true,
        message: `Request to delete ${rows.length} contact${rows.length === 1 ? '' : 's'} sent for approval. Nothing is deleted until our team approves it.`,
      };
    }
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

  async createList(user: AuthUser, dto: CreateListDto) {
    if (user.role === Role.CLIENT) {
      await assertClientAccess(this.prisma, user, dto.clientId);
      return this.requestChange(
        user,
        dto.clientId as string,
        ClientChangeKind.LIST_CREATE,
        null,
        `New list · ${dto.name}`,
        [`New list: ${dto.name}`, dto.description && `Description: ${dto.description}`],
        { name: dto.name, description: dto.description ?? null },
      );
    }
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
        where: { id: dto.listId, tenantId: user.tenantId, ...(await this.ownScope(user)) },
        select: { clientId: true },
      });
      clientId = list?.clientId ?? null;
    }
    if (user.role === Role.CLIENT) {
      // A client imports only into its own workspace and its own lists.
      await assertClientAccess(this.prisma, user, clientId);
      if (dto.listId) {
        const own = await this.prisma.contactList.count({
          where: { id: dto.listId, tenantId: user.tenantId, clientId },
        });
        if (!own) throw new NotFoundException('List not found');
      }
    }

    // Guard against accidental double-submits (clicking Import 2–3 times): if the
    // same file (same name + row count) for the same list/client is already
    // awaiting approval, don't stage another copy.
    const dupePending = await this.prisma.importJob.findFirst({
      where: {
        tenantId: user.tenantId,
        userId: user.userId,
        status: ImportStatus.PENDING,
        filename: dto.filename,
        totalRows: dto.rows.length,
        listId: dto.listId ?? null,
        clientId,
      },
      select: { id: true },
    });
    if (dupePending) {
      throw new ConflictException('This list is already pending approval — no need to submit it again.');
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
      where: { id, tenantId: user.tenantId, ...(await this.ownScope(user)) },
      include: { members: { include: { contact: true } } },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  /** Delete a list (its membership rows cascade; contacts are untouched). */
  async removeList(user: AuthUser, id: string) {
    const list = await this.prisma.contactList.findFirst({
      where: { id, tenantId: user.tenantId, ...(await this.ownScope(user)) },
      include: { _count: { select: { members: true } } },
    });
    if (!list) throw new NotFoundException('List not found');
    if (user.role === Role.CLIENT) {
      const n = list._count.members;
      return this.requestChange(
        user,
        list.clientId as string,
        ClientChangeKind.LIST_DELETE,
        id,
        `Delete list · ${list.name}`,
        [`Delete list: ${list.name} (${n} contact${n === 1 ? '' : 's'}; the contacts themselves are kept)`],
        {},
      );
    }
    await this.prisma.contactList.delete({ where: { id } });
    return { ok: true };
  }

  /** Add existing contacts to a list (idempotent). */
  async addMembers(user: AuthUser, listId: string, contactIds: string[]) {
    const list = await this.prisma.contactList.findFirst({
      where: { id: listId, tenantId: user.tenantId, ...(await this.ownScope(user)) },
    });
    if (!list) throw new NotFoundException('List not found');

    const valid = await this.prisma.contact.findMany({
      where: { id: { in: contactIds }, tenantId: user.tenantId, ...(await this.ownScope(user)) },
      select: { id: true, email: true },
    });
    if (user.role === Role.CLIENT) {
      if (valid.length === 0) return { added: 0 };
      const held = await this.requestChange(
        user,
        list.clientId as string,
        ClientChangeKind.LIST_MEMBERS_ADD,
        listId,
        `Add ${valid.length} to list · ${list.name}`,
        [`List: ${list.name}`, `Add: ${this.emailSample(valid)}`],
        { contactIds: valid.map((c) => c.id) },
      );
      return { added: 0, ...held };
    }
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
      where: { id: listId, tenantId: user.tenantId, ...(await this.ownScope(user)) },
    });
    if (!list) throw new NotFoundException('List not found');

    if (user.role === Role.CLIENT) {
      const members = await this.prisma.contactListMember.findMany({
        where: { listId, contactId: { in: contactIds } },
        select: { contact: { select: { id: true, email: true } } },
      });
      if (members.length === 0) return { removed: 0 };
      const rows = members.map((m) => m.contact);
      const held = await this.requestChange(
        user,
        list.clientId as string,
        ClientChangeKind.LIST_MEMBERS_REMOVE,
        listId,
        `Remove ${rows.length} from list · ${list.name}`,
        [`List: ${list.name}`, `Remove: ${this.emailSample(rows)}`],
        { contactIds: rows.map((c) => c.id) },
      );
      return { removed: 0, ...held };
    }
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
      where: { id: listId, tenantId: user.tenantId, ...(await this.ownScope(user)) },
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
