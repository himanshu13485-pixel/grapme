import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiCampaignsService } from './li-campaigns.service';

/** Admin: reusable Target-Audience presets (tenant-wide). */
@Controller('linkedin/audience-presets')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER)
export class LiPresetsController {
  constructor(private readonly campaigns: LiCampaignsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.campaigns.listPresets(u.tenantId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: { name: string; spec: unknown }) {
    return this.campaigns.createPreset(u.tenantId, dto.name, dto.spec);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.campaigns.deletePreset(u.tenantId, id);
  }
}
