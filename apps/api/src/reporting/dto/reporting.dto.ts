import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SetupGroup, SetupStatus } from '@prisma/client';

/** Update a client step's status, assignee, and/or label (rename). */
export class UpdateSetupStepDto {
  @IsOptional() @IsEnum(SetupStatus) status?: SetupStatus;
  // Empty string clears the assignee; a user id assigns that staff member.
  @IsOptional() @IsString() assigneeUserId?: string;
  // Rename the step (admins only).
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) label?: string;
  // Hide/unhide a default step for THIS client only (admins only).
  @IsOptional() @IsBoolean() hidden?: boolean;
}

/** Add a one-off custom step to a single client's checklist. */
export class AddClientStepDto {
  @IsString() @MinLength(2) @MaxLength(120) label!: string;
  @IsOptional() @IsEnum(SetupGroup) group?: SetupGroup;
}

/** Add a step to the managed default list (applies to every client). */
export class AddTemplateStepDto {
  @IsString() @MinLength(2) @MaxLength(120) label!: string;
  @IsOptional() @IsEnum(SetupGroup) group?: SetupGroup;
}

/** Edit a default-list step (rename / reorder / activate). */
export class UpdateTemplateStepDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) label?: string;
  @IsOptional() @IsEnum(SetupGroup) group?: SetupGroup;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() active?: boolean;
}

/** Move a default step up/down within its group. */
export class MoveTemplateStepDto {
  @IsIn(['up', 'down']) dir!: 'up' | 'down';
}

/** Set a client's months of service (0–12) → generates the monthly arrangement steps. */
export class SetServiceMonthsDto {
  @IsInt() @Min(0) @Max(12) months!: number;
}
