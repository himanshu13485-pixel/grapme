import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import {
  CreateCampaignDto,
  UpdateCampaignDto,
  AddStepDto,
  ScheduleCampaignDto,
} from './dto/campaigns.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.campaigns.list(user, clientId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.getOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(user, id, dto);
  }

  @Post(':id/steps')
  addStep(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddStepDto,
  ) {
    return this.campaigns.addStep(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/submit')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.submit(user, id);
  }

  @Post(':id/schedule')
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ScheduleCampaignDto,
  ) {
    return this.campaigns.schedule(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/pause')
  pause(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.pause(user, id);
  }

  @HttpCode(200)
  @Post(':id/resume')
  resume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.resume(user, id);
  }

  @HttpCode(200)
  @Post(':id/stop')
  stop(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.stop(user, id);
  }

  @Get(':id/analytics')
  analytics(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.campaigns.analytics(user, id, { period, from, to });
  }

  @Get(':id/geo')
  geo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.geoBreakdown(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.remove(user, id);
  }
}
