import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const DEFAULTS = [
  'Wishing you a productive day full of new opportunities!',
  'May your outreach turn into lasting partnerships today.',
  "Here's to closing great deals and growing your business!",
  'Every email you send is a step toward success — keep going!',
  'Great businesses are built one connection at a time. Happy connecting!',
  'May today bring you promising leads and warm replies.',
  'Your next big client could be just one message away!',
  'Consistency wins — wishing you a day of strong results.',
];

@Injectable()
export class GreetingsService {
  constructor(private prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('Admins only');
    }
  }

  private async ensureSeeded(tenantId: string) {
    const count = await this.prisma.greeting.count({ where: { tenantId } });
    if (count > 0) return;
    await this.prisma.greeting.createMany({
      data: DEFAULTS.map((message, i) => ({ tenantId, message, sortOrder: i })),
    });
  }

  /** Admin: on/off flag + all messages. */
  async list(user: AuthUser) {
    this.assertAdmin(user);
    await this.ensureSeeded(user.tenantId);
    const [tenant, messages] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { greetingsEnabled: true },
      }),
      this.prisma.greeting.findMany({
        where: { tenantId: user.tenantId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    return { enabled: tenant?.greetingsEnabled ?? true, messages };
  }

  async create(user: AuthUser, message: string) {
    this.assertAdmin(user);
    const clean = (message ?? '').trim();
    if (!clean) throw new BadRequestException('Message is required.');
    const max = await this.prisma.greeting.aggregate({
      where: { tenantId: user.tenantId },
      _max: { sortOrder: true },
    });
    return this.prisma.greeting.create({
      data: {
        tenantId: user.tenantId,
        message: clean,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const g = await this.prisma.greeting.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!g) throw new NotFoundException('Message not found');
    await this.prisma.greeting.delete({ where: { id } });
    return { ok: true };
  }

  async setEnabled(user: AuthUser, enabled: boolean) {
    this.assertAdmin(user);
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { greetingsEnabled: enabled },
    });
    return { enabled };
  }

  /**
   * Today's greeting for the signed-in user. The "Happy Business" line rotates
   * once per day through the list (a new one each day; repeats after all shown).
   */
  async today(user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { greetingsEnabled: true },
    });
    if (!tenant?.greetingsEnabled) return { enabled: false, message: null };
    await this.ensureSeeded(user.tenantId);
    const messages = await this.prisma.greeting.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { message: true },
    });
    if (messages.length === 0) return { enabled: true, message: null };
    const dayIndex = Math.floor(Date.now() / 86_400_000);
    const pick = messages[dayIndex % messages.length];
    return { enabled: true, message: pick.message };
  }
}
