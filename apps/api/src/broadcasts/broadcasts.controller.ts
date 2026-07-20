import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { BroadcastsService } from './broadcasts.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { CreateBroadcastDto } from './dto/broadcasts.dto';

const ADMIN = [Role.SUPER_ADMIN, Role.SUB_ADMIN] as const;

@Controller('broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  // ── Admin: compose + audit ──
  @Roles(...ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create(user, dto);
  }

  @Roles(...ADMIN)
  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.broadcasts.list(tenantId);
  }

  @Roles(...ADMIN)
  @Post('drafts')
  saveDraft(@CurrentUser() user: AuthUser, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.saveDraft(user, dto);
  }

  @Roles(...ADMIN)
  @Get('drafts/:id')
  getOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.broadcasts.getOne(tenantId, id);
  }

  @Roles(...ADMIN)
  @Patch('drafts/:id')
  updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.updateDraft(user, id, dto);
  }

  @Roles(...ADMIN)
  @Post('drafts/:id/send')
  sendDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.broadcasts.sendDraft(user, id);
  }

  @Roles(...ADMIN)
  @Delete('drafts/:id')
  deleteDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.broadcasts.deleteDraft(user, id);
  }

  // ── Client portal: their Notification page ──
  @Roles(Role.CLIENT)
  @Get('my')
  listMine(@CurrentUser() user: AuthUser) {
    return this.broadcasts.listMine(user);
  }

  @Roles(Role.CLIENT)
  @Get('my/unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.broadcasts.unreadCount(user);
  }

  @Roles(Role.CLIENT)
  @Post('my/:recipientId/read')
  markRead(@CurrentUser() user: AuthUser, @Param('recipientId') recipientId: string) {
    return this.broadcasts.markRead(user, recipientId);
  }
}
