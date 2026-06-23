import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import {
  CreateContactDto,
  CreateListDto,
  ImportContactsDto,
} from './dto/contacts.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller()
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('contacts')
  list(@CurrentUser() user: AuthUser) {
    return this.contacts.list(user);
  }

  @Post('contacts')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.contacts.create(user, dto);
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
  listLists(@CurrentUser() user: AuthUser) {
    return this.contacts.listLists(user);
  }

  @Post('contact-lists')
  createList(@CurrentUser() user: AuthUser, @Body() dto: CreateListDto) {
    return this.contacts.createList(user, dto);
  }

  @Get('contact-lists/:id')
  getList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.getList(user, id);
  }
}
