import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
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
  @IsOptional() @IsString() assignedClientId?: string;
}

class CreateSubAdminDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @MinLength(6) password: string;
  @IsOptional() @IsBoolean() fullAccess?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) accessModules?: string[];
  @IsOptional() @IsBoolean() canDelete?: boolean;
  @IsOptional() @IsBoolean() canEdit?: boolean;
}

class UpdateSubAdminDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @MinLength(6) password?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsBoolean() fullAccess?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) accessModules?: string[];
  @IsOptional() @IsBoolean() canDelete?: boolean;
  @IsOptional() @IsBoolean() canEdit?: boolean;
}

@Roles(Role.SUPER_ADMIN)
@Controller('sub-admins')
export class SubAdminsController {
  constructor(private readonly subAdmins: SubAdminsService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.subAdmins.list(tenantId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSubAdminDto) {
    return this.subAdmins.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubAdminDto,
  ) {
    return this.subAdmins.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.subAdmins.remove(user, id);
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
