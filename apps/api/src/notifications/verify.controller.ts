import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { OtpService } from './otp.service';
import { MessagingChannel, parseChannel } from './channels';

class VerifyCodeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code!: string;
}

/**
 * Optional number verification for the signed-in user, on either messaging
 * channel.
 *
 * Nothing here blocks the account: skipping it simply means we never send that
 * user alerts on that network. Any signed-in role can verify their own number.
 */
@Controller('channel-verify')
export class VerifyController {
  constructor(private readonly otp: OtpService) {}

  /** Both channels at once — what the settings screen renders. */
  @Get()
  all(@CurrentUser() user: AuthUser) {
    return this.otp.statusAll(user.userId);
  }

  /** One channel: the number, whether it's verified, resend cooldown. */
  @Get(':channel')
  status(@CurrentUser() user: AuthUser, @Param('channel') channel: string) {
    return this.otp.status(user.userId, this.channel(channel));
  }

  /** Send (or resend) a code on this channel. */
  @Post(':channel/send')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  send(@CurrentUser() user: AuthUser, @Param('channel') channel: string) {
    return this.otp.issue(user.userId, this.channel(channel));
  }

  /** Check a submitted code. */
  @Post(':channel')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@CurrentUser() user: AuthUser, @Param('channel') channel: string, @Body() dto: VerifyCodeDto) {
    return this.otp.verify(user.userId, this.channel(channel), dto.code);
  }

  private channel(value: string): MessagingChannel {
    const channel = parseChannel(value);
    if (!channel) throw new BadRequestException('Unknown messaging channel.');

    return channel;
  }
}
