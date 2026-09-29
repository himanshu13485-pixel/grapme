import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ResponseTypesService } from './response-types.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

export class CreateResponseTypeDto {
  @IsString() messageId: string;
  @IsString() @MinLength(1) @MaxLength(80) category: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateResponseTypeDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) category?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * Response types are a staff reference (admin, sub-admin, salesperson panels).
 * Deliberately not exposed to the client portal.
 */
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER, Role.SALES)
@Controller('response-types')
export class ResponseTypesController {
  constructor(private readonly responseTypes: ResponseTypesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.responseTypes.list(user.tenantId);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateResponseTypeDto) {
    return this.responseTypes.createFromMessage(user, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateResponseTypeDto,
  ) {
    return this.responseTypes.update(user, id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.responseTypes.remove(user, id);
  }
}
