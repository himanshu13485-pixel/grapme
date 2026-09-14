import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ContactStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single-contact writes, shared by the direct staff path and by approving a
 * client-portal request — so an approved change is written exactly the way a
 * direct one is, with the same checks run again at apply time.
 */

export function dedupeHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export interface ContactCreateInput {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  country?: string;
  /** Add the contact to this existing list on create. */
  listId?: string;
  clientId?: string;
}

export interface ContactUpdateInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  country?: string;
  status?: ContactStatus;
  /** Owning client; empty string clears it. */
  clientId?: string;
  /** Full desired set of list memberships — memberships are synced to match. */
  listIds?: string[];
}

/** Workspaces a client-portal write is limited to; `null` for staff (tenant-wide). */
type Own = string[] | null;
const inOwn = (own: Own) => (own ? { clientId: { in: own } } : {});

/**
 * Checks a single add can go ahead. Contacts are unique per tenant, so a client
 * may never overwrite one that belongs to another workspace, and may only
 * attach it to one of their own lists.
 */
export async function checkContactCreate(
  prisma: PrismaService,
  tenantId: string,
  input: ContactCreateInput,
  own: Own,
): Promise<void> {
  if (own) {
    const existing = await prisma.contact.findUnique({
      where: { tenantId_dedupeHash: { tenantId, dedupeHash: dedupeHash(input.email) } },
      select: { clientId: true },
    });
    if (existing && !(existing.clientId && own.includes(existing.clientId))) {
      throw new ConflictException('This email address can’t be added to this workspace.');
    }
  }
  if (input.listId) {
    const list = await prisma.contactList.findFirst({
      where: { id: input.listId, tenantId, ...inOwn(own) },
      select: { id: true },
    });
    if (!list) throw new NotFoundException('List not found');
  }
}

/** Manual single add: upsert on the tenant dedupe key, optionally into a list. */
export async function writeContactCreate(
  prisma: PrismaService,
  actor: { tenantId: string; userId: string },
  input: ContactCreateInput,
  own: Own,
) {
  await checkContactCreate(prisma, actor.tenantId, input, own);
  const { listId, ...fields } = input;
  const hash = dedupeHash(input.email);
  const contact = await prisma.contact.upsert({
    where: { tenantId_dedupeHash: { tenantId: actor.tenantId, dedupeHash: hash } },
    update: {
      email: fields.email,
      firstName: fields.firstName,
      lastName: fields.lastName,
      company: fields.company,
      country: fields.country,
    },
    create: {
      tenantId: actor.tenantId,
      userId: actor.userId,
      email: fields.email,
      firstName: fields.firstName,
      lastName: fields.lastName,
      company: fields.company,
      country: fields.country,
      clientId: fields.clientId || null,
      dedupeHash: hash,
    },
  });
  if (listId) {
    await prisma.contactListMember.upsert({
      where: { listId_contactId: { listId, contactId: contact.id } },
      update: {},
      create: { listId, contactId: contact.id },
    });
  }
  return contact;
}

/** Checks an edit can go ahead: the target workspace is allowed and the new email is free. */
export async function checkContactUpdate(
  prisma: PrismaService,
  tenantId: string,
  existing: { id: string; dedupeHash: string },
  input: ContactUpdateInput,
  own: Own,
): Promise<void> {
  if (input.clientId !== undefined && own && !(input.clientId && own.includes(input.clientId))) {
    throw new NotFoundException('Workspace not found');
  }
  if (input.email !== undefined && dedupeHash(input.email) !== existing.dedupeHash) {
    const clash = await prisma.contact.findFirst({
      where: { tenantId, dedupeHash: dedupeHash(input.email), NOT: { id: existing.id } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('Another contact already uses that email');
  }
}

/** Edit a contact's fields, status and list memberships. */
export async function writeContactUpdate(
  prisma: PrismaService,
  tenantId: string,
  id: string,
  input: ContactUpdateInput,
  own: Own,
) {
  const existing = await prisma.contact.findFirst({ where: { id, tenantId, ...inOwn(own) } });
  if (!existing) throw new NotFoundException('Contact not found');
  await checkContactUpdate(prisma, tenantId, existing, input, own);

  const data: Record<string, unknown> = {
    firstName: input.firstName,
    lastName: input.lastName,
    company: input.company,
    country: input.country,
  };
  if (input.status !== undefined) data.status = input.status;
  if (input.clientId !== undefined) data.clientId = input.clientId || null;
  // Changing the email changes the dedupe hash (collision checked above).
  if (input.email !== undefined && dedupeHash(input.email) !== existing.dedupeHash) {
    data.email = input.email;
    data.dedupeHash = dedupeHash(input.email);
  }
  const contact = await prisma.contact.update({ where: { id }, data });

  if (input.listIds) {
    const valid = await prisma.contactList.findMany({
      where: { id: { in: input.listIds }, tenantId, ...inOwn(own) },
      select: { id: true },
    });
    const desired = valid.map((v) => v.id);
    await prisma.contactListMember.deleteMany({
      where: { contactId: id, listId: { notIn: desired } },
    });
    for (const listId of desired) {
      await prisma.contactListMember.upsert({
        where: { listId_contactId: { listId, contactId: id } },
        update: {},
        create: { listId, contactId: id },
      });
    }
  }
  return contact;
}
