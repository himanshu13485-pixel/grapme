import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Role, UpdateType } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UpdatesService } from './updates.service';
import { CreateUpdateDto, ReplyUpdateDto } from './dto/update.dto';

/**
 * Work / Meetings / Notification board — shared by admins, sub-admins and clients.
 * Visibility is scoped in the service (admins → all tenant clients, clients → own).
 */
@Controller('updates')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER, Role.CLIENT)
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  // Bell feed (kept above ':id' so these fixed paths aren't captured as an id).
  @Get('bell/unread')
  bellUnread(@CurrentUser() u: AuthUser) { return this.updates.bellUnreadCount(u); }
  @Get('bell/feed')
  bellFeed(@CurrentUser() u: AuthUser) { return this.updates.bellFeed(u); }
  @Post('bell/seen')
  bellSeen(@CurrentUser() u: AuthUser) { return this.updates.bellMarkSeen(u); }
  @Post(':id/seen')
  threadSeen(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.updates.markThreadSeen(u, id); }

  @Get('client-options')
  clientOptions(@CurrentUser() u: AuthUser) { return this.updates.clientOptions(u); }

  @Get()
  list(
    @CurrentUser() u: AuthUser,
    @Query('type') type?: UpdateType,
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
  ) {
    return this.updates.list(u, { type, clientId, search, page: page ? Number(page) : undefined });
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateUpdateDto) { return this.updates.create(u, dto); }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.updates.get(u, id); }

  @Post(':id/replies')
  reply(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReplyUpdateDto) { return this.updates.reply(u, id, dto); }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.updates.remove(u, id); }
}
