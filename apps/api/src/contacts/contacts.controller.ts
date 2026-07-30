import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import {
  CreateContactDto,
  CreateListDto,
  ImportContactsDto,
  ListMembersDto,
  UpdateContactDto,
} from './dto/contacts.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('contacts')
  list(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.contacts.list(user, clientId);
  }

  @Post('contacts')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.contacts.create(user, dto);
  }

  @Patch('contacts/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.update(user, id, dto);
  }

  @Delete('contacts/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.remove(user, id);
  }

  /** Bulk-delete selected contacts. */
  @Post('contacts/delete')
  removeMany(@CurrentUser() user: AuthUser, @Body() body: { ids?: string[] }) {
    return this.contacts.removeMany(user, body.ids ?? []);
  }

  @Post('contacts/import')
  import(@CurrentUser() user: AuthUser, @Body() dto: ImportContactsDto) {
    return this.contacts.import(user, dto);
  }

  @Get('contacts/imports')
  listImports(@CurrentUser() user: AuthUser) {
    return this.contacts.listImports(user);
  }

  @Get('contact-lists')
  listLists(@CurrentUser() user: AuthUser, @Query('clientId') clientId?: string) {
    return this.contacts.listLists(user, clientId);
  }

  @Post('contact-lists')
  createList(@CurrentUser() user: AuthUser, @Body() dto: CreateListDto) {
    return this.contacts.createList(user, dto);
  }

  @Get('contact-lists/:id')
  getList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.getList(user, id);
  }

  @Delete('contact-lists/:id')
  removeList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.removeList(user, id);
  }

  @Post('contact-lists/:id/members')
  addMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ListMembersDto,
  ) {
    return this.contacts.addMembers(user, id, dto.contactIds);
  }

  @Post('contact-lists/:id/members/remove')
  removeMembers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ListMembersDto,
  ) {
    return this.contacts.removeMembers(user, id, dto.contactIds);
  }

  @Post('contact-lists/:id/clean')
  cleanList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.cleanList(user, id);
  }
}
