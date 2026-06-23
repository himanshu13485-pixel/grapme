import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateProfileDto } from './dto/users.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Current user's own profile. */
  @Get('me/profile')
  myProfile(@CurrentUser() user: AuthUser) {
    return this.users.getOne(user.tenantId, user.userId);
  }

  @Patch('me/profile')
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(user.userId, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.users.create(tenantId, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Get(':id')
  getOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.users.getOne(tenantId, id);
  }

  @Roles(Role.SUPER_ADMIN)
  @Post(':id/suspend')
  suspend(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.users.suspend(tenantId, id);
  }
}
