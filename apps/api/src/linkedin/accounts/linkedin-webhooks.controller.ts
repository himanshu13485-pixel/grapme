import { Body, Controller, ForbiddenException, Headers, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { LinkedInAccountsService } from './linkedin-accounts.service';

/** Unipile account webhook → mark seat connected. Public, secret-guarded. */
@Controller('linkedin/webhooks/unipile')
export class LinkedInWebhooksController {
  constructor(
    private readonly accounts: LinkedInAccountsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('accounts')
  account(@Body() body: any, @Query('secret') secret?: string, @Headers('x-webhook-secret') headerSecret?: string) {
    const expected = this.config.get<string>('UNIPILE_WEBHOOK_SECRET');
    if (expected && (secret ?? headerSecret) !== expected) {
      throw new ForbiddenException('Invalid webhook secret');
    }
    const d = body?.data ?? body ?? {};
    return this.accounts.handleAccountWebhook({
      account_id: d.account_id,
      name: d.name,
      status: d.status,
    });
  }
}
