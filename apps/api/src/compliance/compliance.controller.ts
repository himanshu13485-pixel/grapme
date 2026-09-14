import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  HttpCode,
} from '@nestjs/common';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { SuppressionReason } from '@prisma/client';
import { ComplianceService } from './compliance.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

class AddSuppressionDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsEnum(SuppressionReason)
  reason?: SuppressionReason;
}

@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER, SalesGateRole.CLIENT) // excludes SALES (scoped panel only)
@Controller()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  // The tenant-wide suppression list is staff-only: it names every client's
  // opted-out contacts, and removing an entry would re-enable emailing them.
  @SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER)
  @Get('suppression')
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.compliance.listSuppression(tenantId);
  }

  @Post('suppression')
  add(@CurrentUser('tenantId') tenantId: string, @Body() dto: AddSuppressionDto) {
    return this.compliance.addSuppression(
      tenantId,
      dto.email,
      dto.reason ?? SuppressionReason.MANUAL,
    );
  }

  @SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN, SalesGateRole.USER)
  @Delete('suppression/:id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.compliance.removeSuppression(tenantId, id);
  }

  @Get('compliance/contacts/:id/export')
  export(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.compliance.exportContact(user, id);
  }

  @HttpCode(200)
  @Post('compliance/contacts/:id/erase')
  erase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.compliance.eraseContact(user, id);
  }
}
