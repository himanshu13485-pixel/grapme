import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString,
  Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { LiCampaignMode, LiCampaignType, LiOutreachType, LiStepType, LiStepCondition } from '@prisma/client';

export class CreateLiCampaignDto {
  @IsString() clientId!: string;
  @IsString() linkedInAccountId!: string;
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsEnum(LiCampaignType) type?: LiCampaignType;
  @IsOptional() @IsEnum(LiCampaignMode) mode?: LiCampaignMode;
  @IsOptional() @IsEnum(LiOutreachType) outreachType?: LiOutreachType;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() businessProfileId?: string;
  @IsOptional() @IsString() strategyId?: string;
}

export class UpdateLiCampaignDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsEnum(LiCampaignType) type?: LiCampaignType;
  @IsOptional() @IsEnum(LiOutreachType) outreachType?: LiOutreachType;
  @IsOptional() @IsString() timezone?: string;
}

export class LiSequenceStepDto {
  @IsEnum(LiStepType) type!: LiStepType;
  // When this MESSAGE step fires relative to the connection outcome (default ANY).
  @IsOptional() @IsEnum(LiStepCondition) condition?: LiStepCondition;
  @IsInt() @Min(0) waitHours!: number;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() note?: string;
  // Random-choice group: MESSAGE steps sharing a value are alternatives (one sent/lead).
  @IsOptional() @IsInt() @Min(1) randomGroup?: number;
  // Up to 2 alternate wordings (a lead gets one at random from body/note + these).
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(2) variants?: string[];
}

export class UpdateLiSequenceDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => LiSequenceStepDto)
  steps!: LiSequenceStepDto[];
}

export class UpsertLiAudienceDto {
  @IsOptional() @IsArray() @IsString({ each: true }) countries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) cities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) industries?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) companySizes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) departments?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) jobTitles?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) seniorities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) companyKeywordsInclude?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) companyKeywordsExclude?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) personKeywordsInclude?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) personKeywordsExclude?: string[];
}

export class UpdateLiScheduleDto {
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() run247?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) workStartHour?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) workEndHour?: number;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) workDays?: number[];
  @IsOptional() @IsInt() @Min(1) dailyConnectionLimit?: number;
  @IsOptional() @IsInt() @Min(1) dailyMessageLimit?: number;
  @IsOptional() @IsBoolean() warmupEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) warmupStartLimit?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) warmupDays?: number;
  // How long to wait for a connection to be accepted before withdrawing the invite
  // and marking the lead NOT_ACCEPTED (1–30 days).
  @IsOptional() @IsInt() @Min(1) @Max(30) connectionWindowDays?: number;
  @IsOptional() @IsBoolean() dripEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(200) dripDailyTarget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000) dripBuffer?: number;
  // Human-likeness: randomized per-lead follow-up count (0/0 = off = send all) + the
  // grace window before a no-reply lead is marked campaign-completed.
  @IsOptional() @IsInt() @Min(0) @Max(10) followUpMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10) followUpMax?: number;
  @IsOptional() @IsInt() @Min(0) @Max(720) graceHours?: number;
  // Lead-quality gate: only send invites to profiles with at least this many LinkedIn
  // connections (0 = off). Unknown/hidden counts pass.
  @IsOptional() @IsInt() @Min(0) @Max(100000) minConnections?: number;
  // Upper bound: skip profiles ABOVE this many connections (maxed-out accounts can't
  // accept invites). 0 = off.
  @IsOptional() @IsInt() @Min(0) @Max(100000) maxConnections?: number;
}

export class ImportLiLeadDto {
  @IsString() @MinLength(1) fullName!: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() profileUrl?: string;
}

export class ImportLiLeadsDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ImportLiLeadDto)
  leads!: ImportLiLeadDto[];
}

export class GenerateLiMessagesDto {
  @IsOptional() @IsEnum(LiOutreachType) outreachType?: LiOutreachType;
  @IsOptional() @IsInt() @Min(1) @Max(5) followUps?: number;
  // Wordings to generate per step (1 = single, up to 3 for human-like variation).
  @IsOptional() @IsInt() @Min(1) @Max(3) variants?: number;
}

// Prompt-based draft for the MANUAL campaign editor (no knowledge profile needed).
export class DraftLiMessagesDto {
  @IsString() clientId!: string;
  @IsOptional() @IsString() context?: string;
  @IsOptional() @IsEnum(LiOutreachType) outreachType?: LiOutreachType;
  @IsOptional() @IsInt() @Min(1) @Max(5) followUps?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3) variants?: number;
}
