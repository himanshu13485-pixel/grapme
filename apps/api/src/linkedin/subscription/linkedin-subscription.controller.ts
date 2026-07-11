import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LinkedInSubscriptionService } from './linkedin-subscription.service';

class CampaignDefaultsDto {
  @IsOptional() @IsBoolean() run247?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) workStartHour?: number;
  @IsOptional() @IsInt() @Min(1) @Max(23) workEndHour?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(200) dailyConnectionLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) dailyMessageLimit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3600) jitterMinSeconds?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3600) jitterMaxSeconds?: number;
  @IsOptional() @IsBoolean() warmupEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) warmupStartLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) warmupDays?: number;
  @IsOptional() @IsBoolean() dripEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(200) dripDailyTarget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) dripBuffer?: number;
}

class UpdateSubDto {
  @IsOptional() @IsString() planName?: string;
  @IsOptional() @IsInt() @Min(0) seats?: number;
  @IsOptional() @IsInt() @Min(0) campaignLimit?: number;
  @IsOptional() @IsInt() @Min(0) creditsBalance?: number;
  // Validity is governed by the shared client plan (email/Validity menu), not here.
  @IsOptional() @IsBoolean() whatsappEnabled?: boolean;
  @IsOptional() @IsString() whatsappNumber?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @ValidateNested() @Type(() => CampaignDefaultsDto) campaignDefaults?: CampaignDefaultsDto;
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
