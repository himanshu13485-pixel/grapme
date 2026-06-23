import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { DeliverabilityService } from './deliverability.service';

class ValidateEmailDto {
  @IsEmail()
  email: string;
}

class DomainQuery {
  @IsString()
  domain: string;
}

@Controller('deliverability')
export class DeliverabilityController {
  constructor(private readonly deliverability: DeliverabilityService) {}

  @Get('email-auth')
  emailAuth(@Query() query: DomainQuery) {
    return this.deliverability.emailAuth(query.domain);
  }

  @HttpCode(200)
  @Post('validate-email')
  validateEmail(@Body() dto: ValidateEmailDto) {
    return this.deliverability.validateEmail(dto.email);
  }
}
