import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ContactStatus } from '@prisma/client';

export class CreateContactDto {
  @IsEmail()
  email: string;

  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() country?: string;

  /** Optional: add the contact to this existing list on create. */
  @IsOptional() @IsString() listId?: string;
  /** Optional: owning client (empty string clears it). */
  @IsOptional() @IsString() clientId?: string;
}

export class UpdateContactDto {
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsEnum(ContactStatus) status?: ContactStatus;
  /** Owning client; empty string clears it. */
  @IsOptional() @IsString() clientId?: string;

  /** Full desired set of list memberships — memberships are synced to match. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  listIds?: string[];
}

export class CreateListDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  clientId?: string;
}

export class ListMembersDto {
  @IsArray()
  @IsString({ each: true })
  contactIds: string[];
}

export class ImportRowDto {
  @IsEmail()
  email: string;

  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() country?: string;
}

export class ImportContactsDto {
  @IsString()
  filename: string;

  @IsOptional()
  @IsString()
  listId?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}
