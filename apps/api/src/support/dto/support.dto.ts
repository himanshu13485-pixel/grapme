import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Shared attachment fields — a base64 blob (or data: URL) with name + mime. */
class AttachmentFields {
  @IsOptional() @IsString() attachmentBase64?: string;
  @IsOptional() @IsString() @MaxLength(200) attachmentName?: string;
  @IsOptional() @IsString() @MaxLength(150) attachmentMime?: string;
}

export class CreateTicketDto extends AttachmentFields {
  /** The client workspace this ticket is about. Optional when the user owns exactly one. */
  @IsOptional() @IsString() clientId?: string;
  @IsString() @MaxLength(200) subject: string;
  @IsString() @MaxLength(5000) message: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
}

export class ReplyDto extends AttachmentFields {
  @IsString() @MaxLength(5000) message: string;
}

export class FeedbackDto {
  @IsIn(['SATISFIED', 'NOT_SATISFIED']) satisfaction: 'SATISFIED' | 'NOT_SATISFIED';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(['OPEN', 'ANSWERED', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'CLOSED';
  /** Reassign the handler (admin/sub-admin/sales user id); empty string unassigns. */
  @IsOptional() @IsString() assignedToId?: string;
}

export class EscalateDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ResolveEscalationDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
