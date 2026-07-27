import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { WhatsappOtpService } from './whatsapp-otp.service';

class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code!: string;
}

/**
 * Optional WhatsApp number verification for the signed-in user.
 *
 * Nothing here blocks the account: skipping it simply means we never send that
 * user WhatsApp alerts. Any signed-in role can verify their own number.
 */
@Controller('whatsapp-verify')
export class WhatsappVerifyController {
  constructor(private readonly otp: WhatsappOtpService) {}

  /** Current state: the number, whether it's verified, resend cooldown. */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.otp.status(user.userId);
  }

  /** Send (or resend) a code to the user's WhatsApp number. */
  @Post('send')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser) {
    return this.otp.issue(user.userId);
  }

  /** Check a submitted code. */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyCodeDto) {
    return this.otp.verify(user.userId, dto.code);
  }
}
