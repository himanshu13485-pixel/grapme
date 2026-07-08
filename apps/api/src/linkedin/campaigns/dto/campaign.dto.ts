import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString,
  Max, Min, MinLength, ValidateNested,
} from 'class-validator';
import { LiCampaignMode, LiCampaignType, LiOutreachType, LiStepType } from '@prisma/client';

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
  @IsOptional() @IsString() timezone?: string;
}

export class LiSequenceStepDto {
  @IsEnum(LiStepType) type!: LiStepType;
  @IsInt() @Min(0) waitHours!: number;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsString() note?: string;
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
}
