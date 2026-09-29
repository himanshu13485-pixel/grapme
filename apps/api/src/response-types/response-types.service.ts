import { Injectable, NotFoundException } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

export interface CreateResponseTypeInput {
  messageId: string;
  category: string;
  note?: string;
}

export interface UpdateResponseTypeInput {
  category?: string;
  note?: string;
}

/**
 * Saved examples of the kinds of reply buyers send, picked from the Inbox so
 * they can be shown to a client as a reference. A copy of the mail is stored, so
 * the example survives the original being deleted.
 */
@Injectable()
export class ResponseTypesService {
  constructor(private prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.responseType.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async createFromMessage(user: AuthUser, dto: CreateResponseTypeInput) {
    const msg = await this.prisma.emailMessage.findFirst({
      where: { id: dto.messageId, tenantId: user.tenantId, direction: MessageDirection.INBOUND },
      select: { id: true, fromAddress: true, subject: true, body: true },
    });
    if (!msg) throw new NotFoundException('Inbox message not found');
    return this.prisma.responseType.create({
      data: {
        tenantId: user.tenantId,
        messageId: msg.id,
        category: dto.category.trim(),
        note: dto.note?.trim() || null,
        fromAddress: msg.fromAddress,
        subject: msg.subject,
        body: msg.body?.slice(0, 20000) ?? null,
        createdById: user.userId,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateResponseTypeInput) {
    await this.assertOwn(user, id);
    return this.prisma.responseType.update({
      where: { id },
      data: {
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.assertOwn(user, id);
    await this.prisma.responseType.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwn(user: AuthUser, id: string) {
    const found = await this.prisma.responseType.count({ where: { id, tenantId: user.tenantId } });
    if (!found) throw new NotFoundException('Response type not found');
  }
}
