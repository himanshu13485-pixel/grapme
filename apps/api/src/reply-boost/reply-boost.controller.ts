import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ReplyBoostService } from '../common/services/reply-boost.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

export class UpdateReplyBoostDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(100) minPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) maxPct?: number;
}

/** Reply presentation band — the main admin's own setting (My Account). */
@Roles(Role.SUPER_ADMIN)
@Controller('reply-boost')
export class ReplyBoostController {
  constructor(private readonly boost: ReplyBoostService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.boost.settings(user.tenantId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateReplyBoostDto) {
    return this.boost.update(user.tenantId, dto);
  }
}
