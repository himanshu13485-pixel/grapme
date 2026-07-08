import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  IsBoolean, IsInt, IsOptional, IsString, Min, IsDateString,
} from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LinkedInSubscriptionService } from './linkedin-subscription.service';

class UpdateSubDto {
  @IsOptional() @IsString() planName?: string;
  @IsOptional() @IsInt() @Min(0) seats?: number;
  @IsOptional() @IsInt() @Min(0) validityDays?: number;
  @IsOptional() @IsDateString() validityStartAt?: string;
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsString() whatsappNumber?: string;
  @IsOptional() @IsString() timezone?: string;
}
class AdjustCreditsDto {
  @IsInt() amount!: number;
  @IsOptional() @IsString() note?: string;
}

/** Admin-only LinkedIn subscription (separate seats/validity/credits for a shared client). */
@Controller('linkedin/clients/:clientId/subscription')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LinkedInSubscriptionController {
  constructor(private readonly subs: LinkedInSubscriptionService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string) {
    return this.subs.getOrCreate(user.tenantId, clientId);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string, @Body() dto: UpdateSubDto) {
    return this.subs.update(user.tenantId, clientId, dto);
  }

  @Post('credits')
  adjust(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string, @Body() dto: AdjustCreditsDto) {
    return dto.amount >= 0
      ? this.subs.topUp(user.tenantId, clientId, dto.amount, dto.note)
      : this.subs.debit(user.tenantId, clientId, -dto.amount, 'ADJUSTMENT' as any, { note: dto.note });
  }
}
