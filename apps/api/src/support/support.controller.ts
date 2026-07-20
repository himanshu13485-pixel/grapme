import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { SupportService } from './support.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AuthUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import {
  CreateTicketDto,
  EscalateDto,
  FeedbackDto,
  ReplyDto,
  ResolveEscalationDto,
  UpdateTicketDto,
} from './dto/support.dto';

const STAFF = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES] as const;

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  // ── Client portal ──
  @Roles(Role.CLIENT)
  @Get('my/context')
  myContext(@CurrentUser() user: AuthUser) {
    return this.support.myContext(user);
  }

  @Roles(Role.CLIENT)
  @Get('my/tickets')
  myTickets(@CurrentUser() user: AuthUser) {
    return this.support.myTickets(user);
  }

  @Roles(Role.CLIENT)
  @Post('my/tickets')
  createTicket(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto) {
    return this.support.createTicket(user, dto);
  }

  @Roles(Role.CLIENT)
  @Get('my/tickets/:id')
  myTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.myTicket(user, id);
  }

  @Roles(Role.CLIENT)
  @Post('my/tickets/:id/reply')
  myReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.myReply(user, id, dto);
  }

  @Roles(Role.CLIENT)
  @Post('my/tickets/:id/feedback')
  myFeedback(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FeedbackDto) {
    return this.support.myFeedback(user, id, dto);
  }

  // ── Staff + sales console ──
  @Roles(...STAFF)
  @Get('tickets')
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('escalated') escalated?: string,
    @Query('handledBy') handledBy?: string,
  ) {
    return this.support.listTickets(user, { status, escalated, handledBy });
  }

  @Roles(...STAFF)
  @Get('handlers')
  handlers(@CurrentUser() user: AuthUser) {
    return this.support.handlers(user);
  }

  @Roles(...STAFF)
  @Get('tickets/:id')
  getTicket(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.support.getTicket(user, id);
  }

  @Roles(...STAFF)
  @Post('tickets/:id/reply')
  staffReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReplyDto) {
    return this.support.staffReply(user, id, dto);
  }

  @Roles(...STAFF)
  @Patch('tickets/:id')
  updateTicket(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.support.updateTicket(user, id, dto);
  }

  @Roles(...STAFF)
  @Post('tickets/:id/escalate')
  escalate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: EscalateDto) {
    return this.support.escalate(user, id, dto);
  }

  @Roles(...STAFF)
  @Post('tickets/:id/resolve-escalation')
  resolveEscalation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveEscalationDto,
  ) {
    return this.support.resolveEscalation(user, id, dto);
  }

  // ── Shared (any authenticated role; per-record authz inside the service) ──
  @Get('badge')
  badge(@CurrentUser() user: AuthUser) {
    return this.support.badge(user);
  }

  @Get('attachments/:messageId')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ) {
    const file = await this.support.downloadAttachment(user, messageId);
    res.set({
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${file.name.replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(file.data);
  }
}
