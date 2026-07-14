import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetsService {
  private readonly MAX_BYTES = 5 * 1024 * 1024; // 5 MB — keep emails light

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async create(
    tenantId: string,
    dto: { filename?: string; mimeType: string; dataBase64: string },
  ) {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(dto.mimeType)) {
      throw new BadRequestException('Only image files are allowed.');
    }
    // Accept either a raw base64 string or a full data: URL.
    const base64 = (dto.dataBase64 || '').replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Empty file.');
    if (buf.length > this.MAX_BYTES) {
      throw new BadRequestException('Image too large (max 5 MB).');
    }
    const asset = await this.prisma.asset.create({
      data: {
        tenantId,
        filename: (dto.filename || 'image').slice(0, 200),
        mimeType: dto.mimeType,
        data: buf,
      },
      select: { id: true },
    });
    const base = (this.config.get<string>('APP_PUBLIC_URL') ?? 'http://localhost:4000')
      .trim()
      .replace(/\/+$/, '');
    return { id: asset.id, url: `${base}/api/v1/assets/${asset.id}` };
  }

  async getPublic(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      select: { mimeType: true, data: true },
    });
    if (!asset) throw new NotFoundException('Image not found');
    return asset;
  }
}
