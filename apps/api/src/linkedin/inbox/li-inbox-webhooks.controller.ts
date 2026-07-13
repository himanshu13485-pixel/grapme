import { Body, Controller, ForbiddenException, Headers, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';
import { LiInboxService } from './li-inbox.service';

/** Unipile messaging webhook → LinkedIn reply ingestion. Public, secret-guarded. */
@Controller('linkedin/webhooks/unipile')
export class LiInboxWebhooksController {
  constructor(
    private readonly inbox: LiInboxService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('messaging')
  messaging(@Body() body: any, @Query('secret') secret?: string, @Headers('x-webhook-secret') headerSecret?: string) {
    const expected = this.config.get<string>('UNIPILE_WEBHOOK_SECRET');
    if (expected && (secret ?? headerSecret) !== expected) throw new ForbiddenException('Invalid webhook secret');
    const d = body?.data ?? body ?? {};
    return this.inbox.ingestInbound({
      account_id: d.account_id,
      chat_id: d.chat_id ?? d.chat?.id,
      message_id: d.message_id ?? d.id,
      text: d.text ?? d.message,
      is_sender: d.is_sender ?? false,
      timestamp: d.timestamp ?? d.created_at,
      // Sender's LinkedIn member id (spelled a few ways) — lets us attach a reply on a
      // chat the engine never started to the right lead, without an extra API call.
      sender_id: d.sender?.attendee_provider_id ?? d.sender_id ?? d.from?.provider_id ?? d.attendee_provider_id,
    });
  }
}
