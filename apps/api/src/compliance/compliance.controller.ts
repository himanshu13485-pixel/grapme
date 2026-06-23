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

@Controller()
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

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
