import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateBroadcastDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() bodyHtml: string;
  @IsOptional() @IsString() signatureHtml?: string;

  @IsIn(['ALL', 'CHANNEL', 'PLAN', 'CLIENT']) audience: 'ALL' | 'CHANNEL' | 'PLAN' | 'CLIENT';
  /** audience = CHANNEL */
  @IsOptional() @IsIn(['EMAIL', 'LINKEDIN']) channel?: 'EMAIL' | 'LINKEDIN';
  /** audience = PLAN */
  @IsOptional() @IsString() plan?: string;
  /** audience = CLIENT */
  @IsOptional() @IsString() clientId?: string;

  @IsOptional() @IsBoolean() showInApp?: boolean;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
  @IsOptional() @IsBoolean() sendWhatsapp?: boolean;
  @IsOptional() @IsBoolean() sendTelegram?: boolean;
  @IsOptional() @IsBoolean() sendNetvork?: boolean;
}
