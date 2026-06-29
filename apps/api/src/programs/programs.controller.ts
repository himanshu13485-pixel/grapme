import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ProgramsService } from './programs.service';
import {
  AssignMailboxDto,
  CreateClientDto,
  CreateCohortDto,
  SetSequenceDto,
  UpdateClientDto,
} from './dto/programs.dto';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

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

  @Get('clients/:id/cohorts/stats')
  cohortStats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.programs.cohortStats(user, id);
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
  @Post('programs/run-now')
  runNow() {
    return this.programs.runDueNow();
  }

  // Manual trigger of the monthly auto-cohort cron across all clients.
  @Post('programs/run-auto-cohorts')
  runAutoCohorts() {
    return this.programs.runAutoCohorts();
  }
}
