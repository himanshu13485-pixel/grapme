import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LinkedInAccountsService } from './linkedin-accounts.service';

class ConnectDto {
  @IsOptional() @IsString() successRedirect?: string;
}

@Controller('linkedin/clients/:clientId/linkedin-accounts')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LinkedInAccountsController {
  constructor(private readonly accounts: LinkedInAccountsService) {}

  @Post('connect')
  connect(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string, @Body() dto: ConnectDto) {
    return this.accounts.createConnectLink(user.tenantId, clientId, dto.successRedirect);
  }

  @Get()
  list(@Param('clientId') clientId: string) {
    return this.accounts.list(clientId);
  }
}

@Controller('linkedin/linkedin-accounts')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LinkedInAccountByIdController {
  constructor(private readonly accounts: LinkedInAccountsService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.accounts.get(id);
  }

  @Post(':id/sync')
  sync(@Param('id') id: string) {
    return this.accounts.sync(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
