import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalEntity, ApprovalStatus } from '@prisma/client';

export class RejectDto {
  @IsString()
  reason: string;
}

export class ListApprovalsQuery {
  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @IsOptional()
  @IsEnum(ApprovalEntity)
  entityType?: ApprovalEntity;
}
