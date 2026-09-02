import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LinkedInAccountsService } from './linkedin-accounts.service';

class ConnectDto {
  @IsOptional() @IsString() successRedirect?: string;
}

/**
 * Where a seat's traffic egresses from. Send `country` alone for a provider-supplied IP
 * in that country, or the host/port fields for your own proxy. An empty body clears both
 * and hands the seat back to the provider's default.
 */
class SetProxyDto {
  /** ISO 3166-1 alpha-2, e.g. "IN". */
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(['http', 'https', 'socks5']) protocol?: string;
  @IsOptional() @IsString() username?: string;
  /** Write-only; the API never returns it. Omit when editing to keep the stored one. */
  @IsOptional() @IsString() password?: string;
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
    return this.accounts.getPublic(id);
  }

  @Post(':id/sync')
  sync(@Param('id') id: string) {
    return this.accounts.sync(id);
  }

  @Post(':id/proxy')
  setProxy(@Param('id') id: string, @Body() dto: SetProxyDto) {
    return this.accounts.setProxy(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
