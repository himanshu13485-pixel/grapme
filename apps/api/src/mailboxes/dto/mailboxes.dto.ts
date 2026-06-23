import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { MailProtocol } from '@prisma/client';

export class CreateMailboxDto {
  @IsString()
  label: string;

  @IsEnum(MailProtocol)
  protocol: MailProtocol;

  @IsEmail()
  emailAddress: string;

  /** Plaintext password / app-password — encrypted before persistence. */
  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  smtpHost?: string;

  @IsOptional()
  @IsInt()
  smtpPort?: number;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  imapHost?: string;

  @IsOptional()
  @IsInt()
  imapPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  sendSpeedSeconds?: number;
}
