import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInternalNoteDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() bodyHtml: string;
  /** The client this note is about (optional — a note can be general). */
  @IsOptional() @IsString() clientId?: string;

  @IsIn(['ALL_STAFF', 'USER']) audience: 'ALL_STAFF' | 'USER';
  /** audience = USER: the admin / sub-admin to share it with. */
  @IsOptional() @IsString() targetUserId?: string;

  @IsOptional() @IsBoolean() showInApp?: boolean;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}
