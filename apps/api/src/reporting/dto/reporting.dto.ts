import { IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SetupGroup, SetupStatus } from '@prisma/client';

/** Update a client step's status and/or its assigned "concern person". */
export class UpdateSetupStepDto {
  @IsOptional() @IsEnum(SetupStatus) status?: SetupStatus;
  // Empty string clears the assignee; a user id assigns that staff member.
  @IsOptional() @IsString() assigneeUserId?: string;
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
