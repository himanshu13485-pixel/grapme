import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { MarketingService } from './marketing.service';

class LeadDto {
  @IsString() @MinLength(2) @MaxLength(120) name: string;
  @IsString() @MinLength(6) @MaxLength(40) phone: string;
  @IsEmail() @MaxLength(160) email: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsString() captchaToken: string;
  @IsString() captchaAnswer: string;
}

@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  /** Public: arithmetic captcha for the demo/contact form. */
  @Public()
  @Get('captcha')
  captcha() {
    return this.marketing.getCaptcha();
  }

  /** Public: grapme.com demo/contact form → emails the sales inbox. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('lead')
  lead(@Body() dto: LeadDto) {
    return this.marketing.lead(dto);
  }
}
