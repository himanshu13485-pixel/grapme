import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { AssetsService } from './assets.service';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class UploadAssetDto {
  @IsOptional()
  @IsString()
  filename?: string;

  @IsString()
  mimeType: string;

  @IsString()
  dataBase64: string;
}

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Upload an image (base64). Returns a public URL to embed in a template. */
  @Post()
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadAssetDto) {
    return this.assets.create(user.tenantId, dto);
  }

  /** Public — mail clients load images from here by id. */
  @Public()
  @Get(':id')
  async serve(@Param('id') id: string, @Res() res: Response) {
    const asset = await this.assets.getPublic(id);
    res.set({
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.send(asset.data);
  }
}
