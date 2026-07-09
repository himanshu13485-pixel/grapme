import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { LiMessageSource, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiInboxService, InboxTab } from './li-inbox.service';

class ReplyDto {
  @IsString() @MinLength(1) text!: string;
  @IsOptional() @IsIn(['MANUAL', 'AI']) source?: 'MANUAL' | 'AI';
}

@Controller('linkedin')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LiInboxController {
  constructor(private readonly inbox: LiInboxService) {}

  // ── global cross-client inbox ────────────────────────────────────────
  @Get('inbox')
  globalList(
    @CurrentUser() u: AuthUser,
    @Query('tab') tab?: InboxTab,
    @Query('client') client?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inbox.globalList(u.tenantId, {
      tab, clientSearch: client,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('inbox/counts')
  globalCounts(@CurrentUser() u: AuthUser, @Query('client') client?: string) {
    return this.inbox.globalCounts(u.tenantId, client);
  }

  @Get('clients/:clientId/inbox')
  list(
    @Param('clientId') clientId: string,
    @Query('tab') tab?: InboxTab,
    @Query('accountId') accountId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.inbox.list(clientId, {
      tab, accountId, search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('clients/:clientId/inbox/counts')
  counts(@Param('clientId') clientId: string, @Query('accountId') accountId?: string) {
    return this.inbox.counts(clientId, accountId);
  }

  @Get('conversations/:id')
  thread(@Param('id') id: string) {
    return this.inbox.thread(id);
  }

  @Post('conversations/:id/read')
  markRead(@Param('id') id: string) {
    return this.inbox.markRead(id);
  }

  @Post('conversations/:id/reply')
  reply(@Param('id') id: string, @Body() dto: ReplyDto) {
    return this.inbox.reply(id, dto.text, dto.source === 'AI' ? LiMessageSource.AI : LiMessageSource.MANUAL);
  }

  @Post('conversations/:id/ai-fetch')
  aiFetch(@Param('id') id: string) {
    return this.inbox.aiFetch(id);
  }
}
