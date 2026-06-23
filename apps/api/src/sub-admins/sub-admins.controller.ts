import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { SubAdminsService } from './sub-admins.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class AssignDto {
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() assignedCampaignId?: string;
}

@Roles(Role.SUPER_ADMIN)
@Controller('sub-admins')
export class SubAdminsController {
  constructor(private readonly subAdmins: SubAdminsService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.subAdmins.list(tenantId);
  }

  @Get(':id/assignments')
  assignments(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.subAdmins.assignments(tenantId, id);
  }

  @Post(':id/assignments')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignDto,
  ) {
    return this.subAdmins.assign(user, id, dto);
  }

  @Delete('assignments/:assignmentId')
  unassign(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.subAdmins.unassign(user, assignmentId);
  }
}
