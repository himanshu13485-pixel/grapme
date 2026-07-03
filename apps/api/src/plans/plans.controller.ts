import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PlansService } from './plans.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** All roles can read plans (they drive pickers/filters everywhere). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.plans.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: { name: string }) {
    return this.plans.create(user, dto.name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.remove(user, id);
  }
}
