import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const DEFAULTS = ['Growth', 'Growth Plus', 'Enterprise'];

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
  }

  /** List the tenant's plans, self-seeding the defaults on first use. */
  async list(user: AuthUser) {
    let plans = await this.prisma.plan.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (plans.length === 0) {
      await this.prisma.plan.createMany({
        data: DEFAULTS.map((name, i) => ({
          tenantId: user.tenantId,
          name,
          sortOrder: i,
        })),
        skipDuplicates: true,
      });
      plans = await this.prisma.plan.findMany({
        where: { tenantId: user.tenantId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    }
    return plans;
  }

  async create(user: AuthUser, name: string) {
    this.assertAdmin(user);
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Plan name is required.');
    const exists = await this.prisma.plan.findFirst({
      where: { tenantId: user.tenantId, name: { equals: clean, mode: 'insensitive' } },
    });
    if (exists) throw new BadRequestException('That plan name already exists.');
    const max = await this.prisma.plan.aggregate({
      where: { tenantId: user.tenantId },
      _max: { sortOrder: true },
    });
    return this.prisma.plan.create({
      data: {
        tenantId: user.tenantId,
        name: clean,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const plan = await this.prisma.plan.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const inUse = await this.prisma.client.count({
      where: { tenantId: user.tenantId, plan: plan.name },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `Can't delete "${plan.name}" — ${inUse} client${inUse === 1 ? '' : 's'} still use it.`,
      );
    }
    await this.prisma.plan.delete({ where: { id } });
    return { ok: true };
  }
}
