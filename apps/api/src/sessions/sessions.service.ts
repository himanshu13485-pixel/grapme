import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, SESSION_IDLE_MINUTES } from '../auth/auth.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/** A currently-logged-in client, one row per owned client profile. */
export type LiveClientRow = {
  clientId: string | null;
  company: string; // client business name
  contactPerson: string | null; // person on the client side
  phone: string | null;
  email: string | null; // client contact email
  plan: string;
  userId: string; // the portal login (target of "Log out")
  loginEmail: string;
  loginName: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string; // ISO — most recent activity (last token refresh)
  sessionCount: number; // active sessions for this login
};

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Clients currently signed in to the portal — a session counts as live when it
   * has refreshed within the idle window (the app refreshes every ~15 min while a
   * tab is open). Aggregated per login (not per session), then expanded to one row
   * per client profile that login owns.
   */
  async liveClients(user: AuthUser): Promise<LiveClientRow[]> {
    const cutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000);

    // Active sessions for CLIENT logins in this tenant, newest first.
    const tokens = await this.prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        createdAt: { gte: cutoff },
        user: { role: Role.CLIENT, tenantId: user.tenantId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    // Collapse to one live login per user: the newest token wins for IP/last-seen.
    const byUser = new Map<
      string,
      {
        userId: string;
        name: string;
        email: string;
        ip: string | null;
        userAgent: string | null;
        lastSeenAt: Date;
        sessionCount: number;
      }
    >();
    for (const t of tokens) {
      const existing = byUser.get(t.userId);
      if (existing) {
        existing.sessionCount += 1;
        continue;
      }
      byUser.set(t.userId, {
        userId: t.userId,
        name: t.user.name,
        email: t.user.email,
        ip: t.ip,
        userAgent: t.userAgent,
        lastSeenAt: t.createdAt,
        sessionCount: 1,
      });
    }

    const userIds = [...byUser.keys()];
    if (userIds.length === 0) return [];

    const clients = await this.prisma.client.findMany({
      where: { tenantId: user.tenantId, ownerUserId: { in: userIds } },
      select: {
        id: true,
        name: true,
        contactPerson: true,
        mobile: true,
        email: true,
        plan: true,
        ownerUserId: true,
      },
    });
    const clientsByOwner = new Map<string, typeof clients>();
    for (const c of clients) {
      if (!c.ownerUserId) continue;
      const list = clientsByOwner.get(c.ownerUserId) ?? [];
      list.push(c);
      clientsByOwner.set(c.ownerUserId, list);
    }

    const rows: LiveClientRow[] = [];
    for (const s of byUser.values()) {
      const owned = clientsByOwner.get(s.userId) ?? [];
      const base = {
        userId: s.userId,
        loginEmail: s.email,
        loginName: s.name,
        ip: s.ip,
        userAgent: s.userAgent,
        lastSeenAt: s.lastSeenAt.toISOString(),
        sessionCount: s.sessionCount,
      };
      if (owned.length === 0) {
        // A logged-in client login with no profile yet — still surface it.
        rows.push({
          clientId: null,
          company: s.name,
          contactPerson: null,
          phone: null,
          email: s.email,
          plan: '—',
          ...base,
        });
        continue;
      }
      for (const c of owned) {
        rows.push({
          clientId: c.id,
          company: c.name,
          contactPerson: c.contactPerson ?? null,
          phone: c.mobile ?? null,
          email: c.email ?? null,
          plan: c.plan,
          ...base,
        });
      }
    }

    // Most recently active first.
    rows.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return rows;
  }

  /** Force-logout the login that owns a client profile (revokes all its sessions). */
  async logoutClient(user: AuthUser, clientId: string): Promise<{ revoked: number }> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: user.tenantId },
      select: { ownerUserId: true },
    });
    if (!client) throw new NotFoundException('Client not found');
    if (!client.ownerUserId) {
      throw new NotFoundException('This client has no portal login to sign out.');
    }
    const revoked = await this.auth.revokeAllSessions(client.ownerUserId);
    return { revoked };
  }

  /** Force-logout a client login directly by user id (e.g. from Live Clients). */
  async logoutUser(user: AuthUser, userId: string): Promise<{ revoked: number }> {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (target.role !== Role.CLIENT) {
      throw new ForbiddenException('Only client logins can be signed out here.');
    }
    const revoked = await this.auth.revokeAllSessions(userId);
    return { revoked };
  }
}
