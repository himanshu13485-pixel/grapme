import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProgramsService } from './programs.service';
import {
  AssignMailboxDto,
  CreateClientDto,
  CreateCohortDto,
  RenewClientDto,
  SetSequenceDto,
  UpdateClientDto,
} from './dto/programs.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';

// Everyone who could already reach these endpoints — deliberately EXCLUDING SALES,
// whose panel is served only by the scoped /sales/* API. Without this a salesperson
// could read/mutate any client via the raw programs endpoints (their own service-level
// scoping only special-cases CLIENT).
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN, Role.USER, Role.CLIENT)
@Controller()
export class ProgramsController {
  constructor(private readonly programs: ProgramsService) {}

  // Clients
  @Post('clients')
  createClient(@CurrentUser() user: AuthUser, @Body() dto: CreateClientDto) {
    return this.programs.createClient(user, dto);
  }

  @Get('clients')
  listClients(@CurrentUser() user: AuthUser) {
    return this.programs.listClients(user);
  }

  /** Paginated + filtered client list (declared before clients/:id). */
  @Get('clients/paged')
  listClientsPaged(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('email') email?: string,
    @Query('invoice') invoice?: string,
    @Query('status') status?: string,
    @Query('plan') plan?: string,
    @Query('salesPersonId') salesPersonId?: string,
    @Query('linkedInEnabled') linkedInEnabled?: string,
    @Query('channel') channel?: string,
    @Query('expiryFrom') expiryFrom?: string,
    @Query('expiryTo') expiryTo?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('invoiceFrom') invoiceFrom?: string,
    @Query('invoiceTo') invoiceTo?: string,
  ) {
    return this.programs.listClientsPaged(user, {
      page,
      pageSize,
      q,
      email,
      invoice,
      status,
      plan,
      salesPersonId,
      linkedInEnabled,
      channel,
      expiryFrom,
      expiryTo,
      createdFrom,
      createdTo,
      invoiceFrom,
      invoiceTo,
    });
  }

  /** Registered client logins (self-registration visibility), admin-only. */
  @Get('clients/registrations')
  listRegistrations(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('verified') verified?: string,
  ) {
    return this.programs.listRegisteredClients(user, { page, pageSize, q, status, verified });
  }

  /** Admin: create a client workspace owned by an existing registered login. */
  @Post('clients/for-user/:userId')
  createWorkspaceForUser(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: { name?: string; plan?: string },
  ) {
    return this.programs.createWorkspaceForUser(user, userId, body ?? {});
  }

  /** Admin (super only): hard-delete a registered client (+ all its workspaces). */
  @Delete('clients/registrations/:source/:id')
  deleteRegistration(
    @CurrentUser() user: AuthUser,
    @Param('source') source: string,
    @Param('id') id: string,
  ) {
    return this.programs.deleteRegistration(user, source, id);
  }

  /** Profiles the signed-in client-portal user owns (panel switcher). */
  @Get('my/clients')
  myClients(@CurrentUser() user: AuthUser) {
    return this.programs.myClientProfiles(user);
  }

  /** Super/sub admin: create or reset a client-portal login for a profile. */
  @Post('clients/:id/login')
  setClientLogin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { email: string; password?: string },
  ) {
    return this.programs.setClientLogin(user, id, dto);
  }

  /** Admin: activate / deactivate a client (pauses/resumes its cohorts). */
  @Patch('clients/:id/status')
  setClientStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { active: boolean },
  ) {
    return this.programs.setClientStatus(user, id, dto.active);
  }

  /** Admin: force-expire a client's active plan immediately. */
  @Post('clients/:id/subscription/expire')
  forceExpire(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.forceExpireSubscription(user, id);
  }

  /** Admin: set a client's plan validity window (days). */
  @Patch('clients/:id/validity')
  setClientValidity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { days: number | null },
  ) {
    return this.programs.setClientValidity(user, id, dto.days);
  }

  /** Add days to the running validity window, keeping its start date. */
  @Post('clients/:id/validity/extend')
  extendClientValidity(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { days: number },
  ) {
    return this.programs.extendClientValidity(user, id, dto.days);
  }

  /** Admin: renew with a new invoice; the replaced invoice moves to the history. */
  @Post('clients/:id/renew')
  renewClient(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenewClientDto,
  ) {
    return this.programs.renewClient(user, id, dto);
  }

  /** Admin: reset a client login to the shared default password. */
  @Post('clients/:id/reset-password')
  resetClientPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.resetClientDefaultPassword(user, id);
  }

  /** Admin: edit the client login's identity (name/email/phone). */
  @Patch('clients/:id/owner')
  updateClientOwner(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { name?: string; email?: string; mobile?: string },
  ) {
    return this.programs.updateClientOwner(user, id, dto);
  }

  @Get('clients/:id')
  getClient(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.getClient(user, id);
  }

  @Patch('clients/:id')
  updateClient(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.programs.updateClient(user, id, dto);
  }

  @Delete('clients/:id')
  deleteClient(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.deleteClient(user, id);
  }

  /** Send the monthly campaign-data reminder now, to test recipients + mailbox. */
  @Post('clients/:id/campaign-reminder/test')
  testCampaignReminder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.testCampaignReminder(user, id);
  }

  // Mailbox group
  @Post('clients/:id/mailboxes')
  assignMailbox(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignMailboxDto,
  ) {
    return this.programs.assignMailbox(user, id, dto);
  }

  @Delete('clients/:id/mailboxes/:mailboxId')
  unassignMailbox(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('mailboxId') mailboxId: string,
  ) {
    return this.programs.unassignMailbox(user, id, mailboxId);
  }

  // Sequence
  @Put('clients/:id/sequence')
  setSequence(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SetSequenceDto,
  ) {
    return this.programs.setSequence(user, id, dto);
  }

  // Tenant-wide daily line-up across all clients' running cohorts
  @Get('programs/agenda')
  agenda(@CurrentUser() user: AuthUser) {
    return this.programs.agenda(user);
  }

  // Per-cohort sequence (its own plan; falls back to the client default)
  @Get('cohorts/:cohortId/sequence')
  getCohortSequence(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
  ) {
    return this.programs.getCohortSequence(user, cohortId);
  }

  @Put('cohorts/:cohortId/sequence')
  setCohortSequence(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
    @Body() dto: SetSequenceDto,
  ) {
    return this.programs.setCohortSequence(user, cohortId, dto);
  }

  // Cohorts
  @Post('clients/:id/cohorts')
  createCohort(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateCohortDto,
  ) {
    return this.programs.createCohort(user, id, dto);
  }

  @Get('clients/:id/cohorts')
  listCohorts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.listCohorts(user, id);
  }

  /**
   * `from`/`to` (YYYY-MM-DD, both optional) narrow the engagement metrics to
   * emails SENT in that window — used by the report export so a client can be
   * given, say, just August. Omitted = all time, which is what the on-screen
   * report shows.
   */
  @Get('clients/:id/cohorts/stats')
  cohortStats(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.programs.cohortStats(user, id, { from, to });
  }

  @Get('clients/:id/geo')
  cohortGeo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('cohortId') cohortId?: string,
  ) {
    return this.programs.cohortGeo(user, id, cohortId);
  }

  @Post('cohorts/:cohortId/pause')
  pauseCohort(@CurrentUser() user: AuthUser, @Param('cohortId') cohortId: string) {
    return this.programs.pauseCohort(user, cohortId);
  }

  @Post('cohorts/:cohortId/resume')
  resumeCohort(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
  ) {
    return this.programs.resumeCohort(user, cohortId);
  }

  @Post('cohorts/:cohortId/stop')
  stopCohort(@CurrentUser() user: AuthUser, @Param('cohortId') cohortId: string) {
    return this.programs.stopCohort(user, cohortId);
  }

  @Post('cohorts/:cohortId/send-now')
  sendCohortNow(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
  ) {
    return this.programs.sendCohortNow(user, cohortId);
  }

  @Delete('cohorts/:cohortId')
  deleteCohort(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
  ) {
    return this.programs.deleteCohort(user, cohortId);
  }

  // Manual: create the next cohort now from the client's configured source list.
  @Post('clients/:id/auto-cohort/run')
  runAutoCohortForClient(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.programs.createCohortFromSource(user, id);
  }

  // Manual engine trigger (useful for testing without waiting for the tick).
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN) // tenant-wide: never a client
  @Post('programs/run-now')
  runNow() {
    return this.programs.runDueNow();
  }

  // Manual trigger of the monthly auto-cohort cron across all clients.
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN) // tenant-wide: never a client
  @Post('programs/run-auto-cohorts')
  runAutoCohorts() {
    return this.programs.runAutoCohorts();
  }

  // Emergency: pause / resume / stop every cohort in the tenant at once.
  @Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN) // tenant-wide: never a client
  @Post('programs/cohorts/:action')
  controlAll(
    @CurrentUser() user: AuthUser,
    @Param('action') action: 'pause' | 'resume' | 'stop',
  ) {
    return this.programs.controlAllCohorts(user, action);
  }
}
