import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiCampaignsService } from './li-campaigns.service';

/** Admin: Target-Audience presets, scoped to one client workspace. */
@Controller('linkedin/clients/:clientId/audience-presets')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER)
export class LiPresetsController {
  constructor(private readonly campaigns: LiCampaignsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string) {
    return this.campaigns.listPresets(u.tenantId, clientId);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Body() dto: { name: string; spec: unknown }) {
    return this.campaigns.createPreset(u.tenantId, clientId, dto.name, dto.spec);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('clientId') clientId: string, @Param('id') id: string) {
    return this.campaigns.deletePreset(u.tenantId, clientId, id);
  }
}
