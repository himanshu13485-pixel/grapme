import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { StepCondition } from '@prisma/client';

export class CreateCampaignDto {
  @IsString() name: string;
  @IsOptional() @IsString() clientLabel?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() emailAccountId?: string;
  @IsOptional() @IsString() listId?: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsInt() @Min(1) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(10) sendSpeedSeconds?: number;
}

export class UpdateCampaignDto extends CreateCampaignDto {}

export class AddStepDto {
  @IsInt() @Min(1) stepOrder: number;
  @IsOptional() @IsString() templateId?: string;
  @IsInt() @Min(0) waitDays: number;
  @IsOptional() @IsEnum(StepCondition) condition?: StepCondition;
}

export class ScheduleCampaignDto {
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsString() timezone?: string;
}
