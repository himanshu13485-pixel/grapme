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
import { IsOptional, IsString } from 'class-validator';
import { TemplatesService } from './templates.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

export class UpsertTemplateDto {
  @IsString() name: string;
  @IsString() subject: string;
  @IsString() bodyHtml: string;
  @IsOptional() @IsString() bodyText?: string;
  @IsOptional() @IsString() clientId?: string;
}

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.templates.list(user, clientId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: UpsertTemplateDto) {
    return this.templates.create(user, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.getOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertTemplateDto,
  ) {
    return this.templates.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.remove(user, id);
  }

  @HttpCode(200)
  @Post(':id/spam-check')
  spamCheck(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.spamCheck(user, id);
  }
}
