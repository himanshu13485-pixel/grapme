import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { DeliverabilityService } from './deliverability.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class ValidateEmailDto {
  @IsEmail()
  email: string;
}

class DomainQuery {
  @IsString()
  domain: string;
}

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller('deliverability')
export class DeliverabilityController {
  constructor(private readonly deliverability: DeliverabilityService) {}

  @Get('email-auth')
  emailAuth(@Query() query: DomainQuery) {
    return this.deliverability.emailAuth(query.domain);
  }

  /** SPF/DKIM/DMARC status for the tenant's mailbox domains (per-mailbox badges). */
  @Get('mailbox-auth')
  mailboxAuth(@CurrentUser() user: AuthUser) {
    return this.deliverability.mailboxAuth(user.tenantId);
  }

  @HttpCode(200)
  @Post('validate-email')
  validateEmail(@Body() dto: ValidateEmailDto) {
    return this.deliverability.validateEmail(dto.email);
  }
}
