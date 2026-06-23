import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  HttpCode,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ApprovalsService } from './approvals.service';
import { ListApprovalsQuery, RejectDto } from './dto/approvals.dto';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListApprovalsQuery) {
    return this.approvals.list(user, query);
  }

  @HttpCode(200)
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.approvals.approve(user, id);
  }

  @HttpCode(200)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectDto,
  ) {
    return this.approvals.reject(user, id, dto.reason);
  }
}
