import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { InternalWorkService } from './internal-work.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateInternalMessageDto, CreateInternalNoteDto } from './dto/internal-work.dto';

/** Internal Work — staff only (admins, sub-admins & salespersons). Clients never reach this. */
@Controller('internal-work')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES)
export class InternalWorkController {
  constructor(private readonly internal: InternalWorkService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.internal.list(user, clientId);
  }

  @Get('staff')
  staff(@CurrentUser() user: AuthUser) {
    return this.internal.staff(user);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.internal.unreadCount(user);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.internal.getOne(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateInternalNoteDto) {
    return this.internal.create(user, dto);
  }

  @Post('drafts')
  saveDraft(@CurrentUser() user: AuthUser, @Body() dto: CreateInternalNoteDto) {
    return this.internal.saveDraft(user, dto);
  }

  @Patch('drafts/:id')
  updateDraft(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateInternalNoteDto) {
    return this.internal.updateDraft(user, id, dto);
  }

  @Post('drafts/:id/post')
  postDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.internal.postDraft(user, id);
  }

  @Post(':id/messages')
  addMessage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateInternalMessageDto) {
    return this.internal.addMessage(user, id, dto.body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.internal.remove(user, id);
  }
}
