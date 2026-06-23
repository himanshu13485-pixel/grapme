import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { CreditsService } from './credits.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class AdjustDto {
  @IsInt() delta: number;
  @IsString() reason: string;
}

@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService) {}

  /** A user's own balance. */
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.credits.get(user.tenantId, user.userId);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get(':userId')
  get(
    @CurrentUser('tenantId') tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.credits.get(tenantId, userId);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post(':userId/adjust')
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: AdjustDto,
  ) {
    return this.credits.adjust(user, userId, dto.delta, dto.reason);
  }
}
