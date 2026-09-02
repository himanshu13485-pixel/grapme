import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  /** Contact number used for alert notifications on WhatsApp / Telegram. */
  @IsOptional()
  @IsString()
  contactMobile?: string;

  /**
   * The user's Netvork account — App ID, username or email; Netvork resolves
   * all three to the same person. Its own field because Netvork is our app
   * rather than someone else's phone network, so there is no number involved.
   */
  @IsOptional()
  @IsString()
  netvorkAppId?: string;

  /** Per-user alert channel preferences (in-app is always on). */
  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyWhatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyTelegram?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyNetvork?: boolean;
}
