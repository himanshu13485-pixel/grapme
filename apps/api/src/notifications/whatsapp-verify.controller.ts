import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { OtpService } from './otp.service';

class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code!: string;
}

/**
 * The original WhatsApp-only verification routes, kept so a browser still
 * running the previous build keeps working across a deploy.
 *
 * New work should use `/channel-verify/:channel`, which does the same thing for
 * either network — these simply pin the channel to WhatsApp.
 *
 * @deprecated superseded by VerifyController
 */
@Controller('whatsapp-verify')
export class WhatsappVerifyController {
  constructor(private readonly otp: OtpService) {}

  /** The old response shape, `notifyWhatsapp` and all — an older page reads it. */
  @Get()
  async status(@CurrentUser() user: AuthUser) {
    const { notify, ...rest } = await this.otp.status(user.userId, 'whatsapp');

    return { ...rest, notify, notifyWhatsapp: notify };
  }

  @Post('send')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser) {
    return this.otp.issue(user.userId, 'whatsapp');
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@CurrentUser() user: AuthUser, @Body() dto: VerifyCodeDto) {
    return this.otp.verify(user.userId, 'whatsapp', dto.code);
  }
}
