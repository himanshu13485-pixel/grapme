import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Redirect,
} from '@nestjs/common';
import type { Response } from 'express';
import { TrackingService } from './tracking.service';
import { Public } from '../common/decorators/public.decorator';

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

@Public()
@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('t/open/:messageId.png')
  async open(@Param('messageId') messageId: string, @Res() res: Response) {
    await this.tracking.recordOpen(messageId);
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
    });
    res.send(PIXEL);
  }

  @Get('t/click/:messageId')
  @Redirect()
  async click(
    @Param('messageId') messageId: string,
    @Query('u') url: string,
  ) {
    const target = url ? decodeURIComponent(url) : 'about:blank';
    await this.tracking.recordClick(messageId, target);
    return { url: target, statusCode: 302 };
  }

  @Get('unsubscribe/:messageId')
  async unsubscribe(@Param('messageId') messageId: string, @Res() res: Response) {
    await this.tracking.unsubscribe(messageId);
    res.set({ 'Content-Type': 'text/html' });
    res.send(
      '<html><body style="font-family:sans-serif;text-align:center;padding:48px">' +
        '<h2>You have been unsubscribed</h2>' +
        '<p>You will no longer receive emails from this sender.</p>' +
        '</body></html>',
    );
  }
}
