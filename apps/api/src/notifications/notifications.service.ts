import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export interface WhatsappSettings {
  enabled: boolean;
  senderNumber: string;
  provider: string; // META | TWILIO | GUPSHUP
  businessName: string;
  note: string;
}

const DEFAULTS: WhatsappSettings = { enabled: false, senderNumber: '', provider: 'META', businessName: '', note: '' };

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) throw new ForbiddenException('Admins only');
  }

  /** True once the sending credentials are present in the environment. */
  get apiConfigured(): boolean {
    return !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_ID;
  }

  async getWhatsapp(user: AuthUser) {
    const t = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { settings: true } });
    const w = { ...DEFAULTS, ...(((t?.settings as Record<string, unknown>)?.whatsapp as Partial<WhatsappSettings>) ?? {}) };
    return { ...w, apiConfigured: this.apiConfigured };
  }

  async setWhatsapp(user: AuthUser, dto: Partial<WhatsappSettings>) {
    this.assertAdmin(user);
    const t = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { settings: true } });
    const current = (t?.settings as Record<string, unknown>) ?? {};
    const whatsapp: WhatsappSettings = {
      enabled: !!dto.enabled,
      senderNumber: (dto.senderNumber ?? '').trim(),
      provider: dto.provider ?? 'META',
      businessName: (dto.businessName ?? '').trim(),
      note: (dto.note ?? '').trim(),
    };
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: { settings: { ...current, whatsapp } as object },
    });
    return this.getWhatsapp(user);
  }
}
