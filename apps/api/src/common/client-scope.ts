import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators/current-user.decorator';

/**
 * Builds the `clientId` filter for per-client resources (mailboxes, templates,
 * contact lists, contacts) so one client can NEVER see another client's data —
 * even by tampering with the `clientId` query param.
 *
 * - CLIENT: hard-restricted to the workspace(s) they own (a client-portal user
 *   can own several via the profile switcher). A specific `clientId` is honoured
 *   only when it is one of theirs; otherwise the filter spans all their own
 *   workspaces. A client with no workspace sees nothing.
 * - Staff (super-admin / sub-admin / user): `clientId` is an optional filter —
 *   omitted means the whole tenant (the existing global admin views).
 *
 * NOTE: this only scopes *reads/lists*. Tenant-wide invariants — contact
 * dedupe (`tenantId_dedupeHash`) and the suppression/compliance list — are
 * deliberately left untouched.
 */
export async function resourceClientScope(
  prisma: PrismaService,
  user: AuthUser,
  clientId?: string,
): Promise<Record<string, unknown>> {
  if (user.role === Role.CLIENT) {
    const owned = await prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: user.userId },
      select: { id: true },
    });
    const ids = owned.map((c) => c.id);
    if (ids.length === 0) return { clientId: '__none__' }; // owns nothing → match nothing
    if (clientId && ids.includes(clientId)) return { clientId };
    return { clientId: { in: ids } };
  }
  return clientId ? { clientId } : {};
}
