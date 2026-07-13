import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UpdateType } from '@prisma/client';

export class CreateUpdateDto {
  @IsString() clientId!: string;
  @IsEnum(UpdateType) type!: UpdateType;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) bodyHtml!: string;
  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifyWhatsapp?: boolean;
}

export class ReplyUpdateDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}
