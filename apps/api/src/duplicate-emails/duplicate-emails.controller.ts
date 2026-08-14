import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import { Controller, Delete, Get, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { DuplicateEmailsService } from './duplicate-emails.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN) // admin report only
@Controller('duplicate-emails')
export class DuplicateEmailsController {
  constructor(private readonly service: DuplicateEmailsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.service.list(user, search);
  }

  @Get('export')
  async export(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('search') search?: string,
  ) {
    const csv = await this.service.exportCsv(user, search);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="duplicate-emails.csv"',
      'Cache-Control': 'private, no-store',
    });
    res.send(csv);
  }

  @Delete('clear')
  clear(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.service.clear(user, search);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user, id);
  }
}
