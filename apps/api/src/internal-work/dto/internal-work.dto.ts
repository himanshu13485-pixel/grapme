import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInternalNoteDto {
  @IsString() @MaxLength(200) title: string;
  @IsString() bodyHtml: string;
  /** The client this note is about (optional — a note can be general). */
  @IsOptional() @IsString() clientId?: string;

  @IsIn(['ALL_STAFF', 'ALL_STAFF_SALES', 'USER']) audience: 'ALL_STAFF' | 'ALL_STAFF_SALES' | 'USER';
  /** audience = USER: the staff member (admin / sub-admin / salesperson) to share it with. */
  @IsOptional() @IsString() targetUserId?: string;

  @IsOptional() @IsBoolean() showInApp?: boolean;
  @IsOptional() @IsBoolean() sendEmail?: boolean;
}

/** A chat reply in an internal note's thread. */
export class CreateInternalMessageDto {
  @IsString() @MinLength(1) @MaxLength(5000) body: string;
}
