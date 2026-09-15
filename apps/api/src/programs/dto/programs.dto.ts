import { Transform, Type } from 'class-transformer';
import { normalizeCsvListInput } from '../../common/csv-list';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** An operations person to cc on the monthly campaign-data reminder. */
export class OperationContactDto {
  @IsOptional() @IsString() name?: string;
  @IsEmail() email: string;
}

/** Client-facing LinkedIn send window (basic), collected at self-service setup. */
export class LiClientSendWindowDto {
  @IsOptional() @IsInt() @Min(0) @Max(23) workStartHour?: number;
  @IsOptional() @IsInt() @Min(1) @Max(23) workEndHour?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(1) @Max(200) dailyConnectionLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) dailyMessageLimit?: number;
}

export class CreateClientDto {
  @IsString() name: string;
  // Required for staff-created clients (checked in the service; self-setup is exempt).
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OperationContactDto) operationContacts?: OperationContactDto[];
  @IsOptional() @Transform(normalizeCsvListInput) @IsString() invoiceNo?: string; // comma-separated
  @IsOptional() @IsString() invoiceDate?: string; // ISO date (yyyy-mm-dd) or empty
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @Transform(normalizeCsvListInput) @IsString() productCategory?: string; // comma-separated
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInCreditMetering?: boolean;
  @IsOptional() @IsInt() @Min(0) validityDays?: number; // plan validity window in days (0 = no expiry)
  // Per-client Email entitlements (defaulted from the plan, overridable).
  @IsOptional() @IsInt() @Min(0) emailCredits?: number;
  @IsOptional() @IsBoolean() emailCreditMetering?: boolean;
  @IsOptional() @IsInt() @Min(0) mailboxLimit?: number;
  @IsOptional() @IsInt() @Min(0) emailCampaignLimit?: number;
  // Client self-service LinkedIn request: the basic send window they'd like.
  @IsOptional() @ValidateNested() @Type(() => LiClientSendWindowDto) linkedin?: LiClientSendWindowDto;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) monthlyQuota?: number;
  @IsOptional() @IsInt() @Min(1) dailyBatchSize?: number;
  @IsOptional() @IsInt() @Min(1) batchWindowDays?: number;
  @IsOptional() @IsInt() @Min(1) stageIntervalDays?: number;
  @IsOptional() @IsInt() @Min(0) followUpCount?: number;
  @IsOptional() @IsBoolean() weekdaysOnly?: boolean;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(600) emailJitterSeconds?: number;
  @IsOptional() @IsInt() @Min(0) sendWindowStart?: number;
  @IsOptional() @IsInt() @Min(1) sendWindowEnd?: number;
  @IsOptional() @IsInt() @Min(0) stageIntervalJitterDays?: number;
}

export class UpdateClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OperationContactDto) operationContacts?: OperationContactDto[];
  @IsOptional() @Transform(normalizeCsvListInput) @IsString() invoiceNo?: string; // comma-separated
  @IsOptional() @IsString() invoiceDate?: string; // ISO date (yyyy-mm-dd) or empty
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @Transform(normalizeCsvListInput) @IsString() productCategory?: string; // comma-separated
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInEnabled?: boolean;
  @IsOptional() @IsBoolean() linkedInCreditMetering?: boolean;
  @IsOptional() @IsInt() @Min(0) validityDays?: number;
  @IsOptional() @IsInt() @Min(0) emailCredits?: number;
  @IsOptional() @IsBoolean() emailCreditMetering?: boolean;
  @IsOptional() @IsInt() @Min(0) mailboxLimit?: number;
  @IsOptional() @IsInt() @Min(0) emailCampaignLimit?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) monthlyQuota?: number;
  @IsOptional() @IsInt() @Min(1) dailyBatchSize?: number;
  @IsOptional() @IsInt() @Min(1) batchWindowDays?: number;
  @IsOptional() @IsInt() @Min(1) stageIntervalDays?: number;
  @IsOptional() @IsInt() @Min(0) followUpCount?: number;
  @IsOptional() @IsBoolean() weekdaysOnly?: boolean;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(600) emailJitterSeconds?: number;
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
  /** Which month this cohort joins. Blank = start the next month in the
   *  series; an existing month = add to it as the next letter (#2A, #2B, …). */
  @IsOptional() @IsInt() @Min(1) monthIndex?: number;
  /** Source contacts: a contact list, an explicit set of ids, or both. */
  @IsOptional() @IsString() listId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) contactIds?: string[];
  /** Optional future start — upload a cohort in advance; sending begins then. */
  @IsOptional() @IsDateString() startDate?: string;
}

/**
 * Renew a client's subscription with a new invoice. The invoice being replaced moves to
 * the subscription history; plan and validity default to the client's current values.
 */
export class RenewClientDto {
  @Transform(normalizeCsvListInput) @IsString() invoiceNo: string; // comma-separated
  @IsDateString() invoiceDate: string; // yyyy-mm-dd
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) validityDays?: number;
}
