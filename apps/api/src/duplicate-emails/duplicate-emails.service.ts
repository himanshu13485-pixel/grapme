import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class DuplicateEmailsService {
  constructor(private prisma: PrismaService) {}

  private where(user: AuthUser, search?: string): Prisma.DuplicateEmailWhereInput {
    const q = search?.trim();
    return {
      tenantId: user.tenantId,
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { fileName: { contains: q, mode: 'insensitive' } },
              { newListName: { contains: q, mode: 'insensitive' } },
              { newCompany: { contains: q, mode: 'insensitive' } },
              { existingListNames: { contains: q, mode: 'insensitive' } },
              { existingCompany: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  /** Admin / sub-admin report of import duplicates (most recent first). */
  async list(user: AuthUser, search?: string) {
    this.assertStaff(user);
    return this.prisma.duplicateEmail.findMany({
      where: this.where(user, search),
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  /** CSV of the (optionally filtered) duplicates for download. */
  async exportCsv(user: AuthUser, search?: string): Promise<string> {
    this.assertStaff(user);
    const rows = await this.prisma.duplicateEmail.findMany({
      where: this.where(user, search),
      orderBy: { createdAt: 'desc' },
      take: 20000,
    });
    const header = [
      'Email',
      'File Name',
      'Uploaded Into List',
      'Uploaded Company',
      'Already Exists In List(s)',
      'Existing Company',
      'Detected At',
    ];
    const lines = rows.map((r) =>
      [
        r.email,
        r.fileName ?? '',
        r.newListName ?? '',
        r.newCompany ?? '',
        r.existingListNames ?? '',
        r.existingCompany ?? '',
        r.createdAt.toISOString(),
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.map(csvCell).join(','), ...lines].join('\r\n');
  }

  /** Delete one entry (delete-right gated). */
  async remove(user: AuthUser, id: string) {
    await this.assertCanDelete(user);
    await this.prisma.duplicateEmail.deleteMany({ where: { id, tenantId: user.tenantId } });
    return { ok: true };
  }

  /** Clear the whole (optionally filtered) report (delete-right gated). */
  async clear(user: AuthUser, search?: string) {
    await this.assertCanDelete(user);
    const res = await this.prisma.duplicateEmail.deleteMany({ where: this.where(user, search) });
    return { deleted: res.count };
  }

  private assertStaff(user: AuthUser) {
    if (user.role !== Role.SUPER_ADMIN && user.role !== Role.SUB_ADMIN) {
      throw new ForbiddenException('No access');
    }
  }

  /** Super admins always; sub-admins only with the explicit delete flag. */
  private async assertCanDelete(user: AuthUser) {
    if (user.role === Role.SUPER_ADMIN) return;
    if (user.role === Role.SUB_ADMIN) {
      const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { canDelete: true } });
      if (u?.canDelete) return;
    }
    throw new ForbiddenException('You do not have delete access');
  }
}

/** Quote a CSV cell when it contains a comma, quote or newline. */
function csvCell(value: string): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
