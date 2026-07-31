import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { UpdateType } from '@prisma/client';

/** Shared attachment fields — a base64 blob (or data: URL) with name + mime. */
class AttachmentFields {
  @IsOptional() @IsString() attachmentBase64?: string;
  @IsOptional() @IsString() @MaxLength(200) attachmentName?: string;
  @IsOptional() @IsString() @MaxLength(150) attachmentMime?: string;
}

export class CreateUpdateDto extends AttachmentFields {
  @IsString() clientId!: string;
  @IsEnum(UpdateType) type!: UpdateType;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) bodyHtml!: string;
  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifyWhatsapp?: boolean;
}

export class ReplyUpdateDto extends AttachmentFields {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}
