import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportingService } from './reporting.service';
import { AddClientStepDto, AddTemplateStepDto, UpdateSetupStepDto, UpdateTemplateStepDto } from './dto/reporting.dto';

const ADMIN = [Role.SUPER_ADMIN, Role.SUB_ADMIN] as const;
const STAFF = [Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.SALES] as const;

/** Client-workspace setup reporting (onboarding tracker). Admin + assigned salesperson. */
@Controller('reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  // ── clients + progress ──
  @Roles(...STAFF)
  @Get('clients')
  listClients(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.reporting.listClients(user, search);
  }

  @Roles(...STAFF)
  @Get('progress')
  progress(@CurrentUser() user: AuthUser) {
    return this.reporting.progressMap(user);
  }

  /** Client-portal: the caller's own setup progress (for the dashboard box). */
  @Roles(Role.CLIENT)
  @Get('my-progress')
  myProgress(@CurrentUser() user: AuthUser) {
    return this.reporting.myProgress(user);
  }

  @Roles(...STAFF)
  @Get('team')
  team(@CurrentUser() user: AuthUser) {
    return this.reporting.teamMembers(user);
  }

  // ── managed default checklist ──
  @Roles(...ADMIN)
  @Get('template')
  listTemplate(@CurrentUser() user: AuthUser) {
    return this.reporting.listTemplate(user);
  }

  @Roles(...ADMIN)
  @Post('template')
  addTemplate(@CurrentUser() user: AuthUser, @Body() dto: AddTemplateStepDto) {
    return this.reporting.addTemplateStep(user, dto);
  }

  @Roles(...ADMIN)
  @Patch('template/:id')
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTemplateStepDto) {
    return this.reporting.updateTemplateStep(user, id, dto);
  }

  @Roles(...ADMIN)
  @Delete('template/:id')
  removeTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reporting.removeTemplateStep(user, id);
  }

  // ── one client's checklist ──
  @Roles(...STAFF)
  @Get('clients/:clientId')
  clientDetail(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string) {
    return this.reporting.clientDetail(user, clientId);
  }

  @Roles(...ADMIN)
  @Post('clients/:clientId/steps')
  addStep(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string, @Body() dto: AddClientStepDto) {
    return this.reporting.addCustomStep(user, clientId, dto);
  }

  @Roles(...STAFF)
  @Patch('steps/:stepId')
  updateStep(@CurrentUser() user: AuthUser, @Param('stepId') stepId: string, @Body() dto: UpdateSetupStepDto) {
    return this.reporting.updateStep(user, stepId, dto);
  }

  @Roles(...ADMIN)
  @Delete('steps/:stepId')
  deleteStep(@CurrentUser() user: AuthUser, @Param('stepId') stepId: string) {
    return this.reporting.deleteStep(user, stepId);
  }
}
