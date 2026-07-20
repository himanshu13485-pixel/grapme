import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateSalesPersonDto {
  @IsString() name: string; // Executive name
  @IsOptional() @IsString() mobile?: string; // Office mobile
  @IsEmail() email: string; // Registered email
  @MinLength(6) password: string; // required on create
}

export class UpdateSalesPersonDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsEmail() email?: string;
  /** Blank/omitted keeps the current password. */
  @IsOptional() @MinLength(6) password?: string;
  @IsOptional() @IsString() status?: string;
}

export class AssignClientsDto {
  /** The salesperson to assign; omit or null to UNASSIGN the given clients. */
  @IsOptional() @IsString() salesPersonId?: string | null;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) clientIds: string[];
}
