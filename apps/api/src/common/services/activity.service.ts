import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { activityContext } from '../activity-context';

interface LogInput {
  tenantId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}

/** Append-only audit trail. Every state change should call this. */
@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  log(input: LogInput) {
    // Tell the global audit interceptor this request has its own entry.
    const ctx = activityContext.getStore();
    if (ctx) ctx.logged = true;
    return this.prisma.activityLog.create({
      data: {
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as object | undefined,
        after: input.after as object | undefined,
        ipAddress: input.ipAddress,
      },
    });
  }

  list(tenantId: string, take = 100) {
    return this.prisma.activityLog.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take,
    });
  }
}
