import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateClientDto {
  @IsString() name: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() productCategory?: string;
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInEnabled?: boolean;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) monthlyQuota?: number;
  @IsOptional() @IsInt() @Min(1) dailyBatchSize?: number;
  @IsOptional() @IsInt() @Min(1) batchWindowDays?: number;
  @IsOptional() @IsInt() @Min(1) stageIntervalDays?: number;
  @IsOptional() @IsInt() @Min(0) followUpCount?: number;
  @IsOptional() @IsBoolean() weekdaysOnly?: boolean;
  @IsOptional() @IsInt() @Min(0) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(1) sendWindowEnd?: number;
  @IsOptional() @IsInt() @Min(0) stageIntervalJitterDays?: number;
}

export class UpdateClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() productCategory?: string;
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInEnabled?: boolean;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) monthlyQuota?: number;
  @IsOptional() @IsInt() @Min(1) dailyBatchSize?: number;
  @IsOptional() @IsInt() @Min(1) batchWindowDays?: number;
  @IsOptional() @IsInt() @Min(1) stageIntervalDays?: number;
  @IsOptional() @IsInt() @Min(0) followUpCount?: number;
  @IsOptional() @IsBoolean() weekdaysOnly?: boolean;
  @IsOptional() @IsBoolean() autoCohortEnabled?: boolean;
  @IsOptional() @IsString() autoCohortListId?: string;
  @IsOptional() @IsInt() @Min(1) autoCohortDay?: number;
  @IsOptional() @IsInt() @Min(0) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(1) sendWindowEnd?: number;
  @IsOptional() @IsInt() @Min(0) stageIntervalJitterDays?: number;
  @IsOptional() @IsBoolean() reportDaily?: boolean;
  @IsOptional() @IsBoolean() reportWeekly?: boolean;
  @IsOptional() @IsBoolean() reportMonthly?: boolean;
  @IsOptional() @IsInt() @Min(0) reportHour?: number;
}

export class AssignMailboxDto {
  @IsString() mailboxId: string;
  @IsOptional() @IsInt() rotationOrder?: number;
}

export class SequenceStepDto {
  @IsInt() @Min(0) stageOrder: number;
  @IsOptional() @IsString() templateId?: string;
  /** Per-mailbox template variants (index = mailbox rotation position). */
  @IsOptional() @IsArray() @IsString({ each: true }) templateIds?: string[];
  /** Which cohort-month this stage sends in (1-based). The server derives the
   *  day-gap the engine uses from this. */
  @IsOptional() @IsInt() @Min(1) monthOffset?: number;
}

export class SetSequenceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  steps: SequenceStepDto[];
}

export class CreateCohortDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsInt() monthIndex?: number;
  /** Source contacts: a contact list, an explicit set of ids, or both. */
  @IsOptional() @IsString() listId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) contactIds?: string[];
  /** Optional future start — upload a cohort in advance; sending begins then. */
  @IsOptional() @IsDateString() startDate?: string;
}
