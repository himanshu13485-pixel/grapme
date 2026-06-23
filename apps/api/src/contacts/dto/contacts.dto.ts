import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateContactDto {
  @IsEmail()
  email: string;

  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() country?: string;
}

export class CreateListDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}
