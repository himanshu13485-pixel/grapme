import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
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

  /** SMTP login when it differs from the From address (e.g. AWS SES AKIA… user). */
  @IsOptional()
  @IsString()
  smtpUsername?: string;

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

  /** Outgoing encryption: SSL (implicit TLS), STARTTLS, or NONE. */
  @IsOptional()
  @IsIn(['SSL', 'STARTTLS', 'NONE'])
  smtpEncryption?: string;

  @IsOptional()
  @IsString()
  imapHost?: string;

  @IsOptional()
  @IsInt()
  imapPort?: number;

  /** Incoming encryption: SSL (implicit TLS), STARTTLS, or NONE. */
  @IsOptional()
  @IsIn(['SSL', 'STARTTLS', 'NONE'])
  imapEncryption?: string;

  /** IMAP login when receiving lives on a different host (e.g. mailbox user). */
  @IsOptional()
  @IsString()
  imapUsername?: string;

  /** IMAP password — encrypted before persistence. Falls back to SMTP password. */
  @IsOptional()
  @IsString()
  imapPassword?: string;

  /** Accept a self-signed / private-CA IMAP TLS certificate (e.g. some
   *  self-hosted mail servers). Only relax this for hosts you control. */
  @IsOptional()
  @IsBoolean()
  imapAllowSelfSigned?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  sendSpeedSeconds?: number;

  /** Allocate the new mailbox to a client (its sending group) on create. */
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsInt()
  rotationOrder?: number;
}

export class UpdateMailboxDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsEnum(MailProtocol) protocol?: MailProtocol;
  @IsOptional() @IsEmail() emailAddress?: string;
  @IsOptional() @IsString() smtpUsername?: string;

  /** Optional — only re-encrypts/replaces the password when provided. */
  @IsOptional() @IsString() password?: string;

  @IsOptional() @IsString() smtpHost?: string;
  @IsOptional() @IsInt() smtpPort?: number;
  @IsOptional() @IsBoolean() smtpSecure?: boolean;
  @IsOptional() @IsIn(['SSL', 'STARTTLS', 'NONE']) smtpEncryption?: string;
  @IsOptional() @IsString() imapHost?: string;
  @IsOptional() @IsInt() imapPort?: number;
  @IsOptional() @IsIn(['SSL', 'STARTTLS', 'NONE']) imapEncryption?: string;
  @IsOptional() @IsString() imapUsername?: string;
  @IsOptional() @IsString() imapPassword?: string;
  @IsOptional() @IsBoolean() imapAllowSelfSigned?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(2000) dailyLimit?: number;
  @IsOptional() @IsInt() @Min(10) sendSpeedSeconds?: number;
  @IsOptional() @IsBoolean() warmupEnabled?: boolean;
}

export class SendTestEmailDto {
  @IsEmail()
  to: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
