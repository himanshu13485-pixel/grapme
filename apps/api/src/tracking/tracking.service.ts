import { Injectable } from '@nestjs/common';
import { EventType, SuppressionReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  private async message(messageId: string) {
    return this.prisma.emailMessage.findUnique({ where: { id: messageId } });
  }

  /** Normalizes IPv4-mapped IPv6 (::ffff:1.2.3.4) and localhost forms. */
  private cleanIp(ip?: string): string | undefined {
    if (!ip) return undefined;
    return ip.replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
  }

  async recordOpen(messageId: string, ip?: string, ua?: string) {
    const msg = await this.message(messageId);
    if (msg) {
      await this.prisma.emailEvent.create({
        data: {
          messageId,
          campaignId: msg.campaignId,
          eventType: EventType.OPEN,
          meta: { ip: this.cleanIp(ip), ua },
        },
      });
    }
  }

  async recordClick(messageId: string, url: string, ip?: string, ua?: string) {
    const msg = await this.message(messageId);
    if (msg) {
      await this.prisma.emailEvent.create({
        data: {
          messageId,
          campaignId: msg.campaignId,
          eventType: EventType.CLICK,
          meta: { url, ip: this.cleanIp(ip), ua },
        },
      });
    }
  }

  /** Adds the recipient to the tenant suppression list + flips the contact. */
  async unsubscribe(messageId: string) {
    const msg = await this.prisma.emailMessage.findUnique({
      where: { id: messageId },
      include: { contact: true },
    });
    if (!msg?.contact) return;

    await this.prisma.$transaction([
      this.prisma.suppression.upsert({
        where: {
          tenantId_email: {
            tenantId: msg.tenantId,
            email: msg.contact.email,
          },
        },
        update: {},
        create: {
          tenantId: msg.tenantId,
          email: msg.contact.email,
          reason: SuppressionReason.UNSUBSCRIBE,
        },
      }),
      this.prisma.contact.update({
        where: { id: msg.contact.id },
        data: { status: 'UNSUBSCRIBED' },
      }),
      this.prisma.emailEvent.create({
        data: {
          messageId,
          campaignId: msg.campaignId,
          eventType: EventType.UNSUBSCRIBE,
        },
      }),
    ]);
  }
}
