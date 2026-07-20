import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { GreetingsService } from './greetings.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller('greetings')
export class GreetingsController {
  constructor(private readonly greetings: GreetingsService) {}

  /** Today's greeting for the signed-in user (client dashboard). */
  @Get('today')
  today(@CurrentUser() user: AuthUser) {
    return this.greetings.today(user);
  }

  /** Admin: manage messages + on/off. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.greetings.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: { message: string }) {
    return this.greetings.create(user, dto.message);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.greetings.remove(user, id);
  }

  @Patch('settings')
  setEnabled(@CurrentUser() user: AuthUser, @Body() dto: { enabled: boolean }) {
    return this.greetings.setEnabled(user, dto.enabled);
  }
}
