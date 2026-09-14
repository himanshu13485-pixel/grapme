import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators/current-user.decorator';

/**
 * Client workspaces a client-portal user owns (a login can own several via the
 * profile switcher). `null` for staff, who are not client-restricted.
 */
export async function ownedClientIds(
  prisma: PrismaService,
  user: AuthUser,
): Promise<string[] | null> {
  if (user.role !== Role.CLIENT) return null;
  const owned = await prisma.client.findMany({
    where: { tenantId: user.tenantId, ownerUserId: user.userId },
    select: { id: true },
  });
  return owned.map((c) => c.id);
}

/**
 * Builds the `clientId` filter for per-client resources (mailboxes, templates,
 * contact lists, contacts, campaigns) so one client can NEVER see another
 * client's data — even by tampering with the `clientId` query param.
 *
 * - CLIENT: hard-restricted to the workspace(s) they own. A specific `clientId`
 *   is honoured only when it is one of theirs; otherwise the filter spans all
 *   their own workspaces. A client with no workspace sees nothing.
 * - Staff (super-admin / sub-admin / user): `clientId` is an optional filter —
 *   omitted means the whole tenant (the existing global admin views).
 *
 * Tenant-wide invariants — contact dedupe (`tenantId_dedupeHash`) and the
 * suppression list — are deliberately left untouched.
 */
export async function resourceClientScope(
  prisma: PrismaService,
  user: AuthUser,
  clientId?: string,
): Promise<Record<string, unknown>> {
  const ids = await ownedClientIds(prisma, user);
  if (ids === null) return clientId ? { clientId } : {};
  if (ids.length === 0) return { clientId: '__none__' }; // owns nothing → match nothing
  if (clientId && ids.includes(clientId)) return { clientId };
  return { clientId: { in: ids } };
}

/**
 * For WRITES: throws unless a client-portal user owns `clientId` (a missing id
 * fails too — a client can't create shared, workspace-less resources). Staff
 * always pass.
 */
export async function assertClientAccess(
  prisma: PrismaService,
  user: AuthUser,
  clientId?: string | null,
): Promise<void> {
  const ids = await ownedClientIds(prisma, user);
  if (ids === null) return;
  if (!clientId || !ids.includes(clientId)) {
    throw new NotFoundException('Workspace not found');
  }
}
