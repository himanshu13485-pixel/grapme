import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  HttpCode,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { TemplatesService } from './templates.service';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

export class UpsertTemplateDto {
  @IsString() name: string;
  @IsString() subject: string;
  @IsString() bodyHtml: string;
  @IsOptional() @IsString() bodyText?: string;
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: UpsertTemplateDto) {
    return this.templates.create(user, dto);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.getOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpsertTemplateDto,
  ) {
    return this.templates.update(user, id, dto);
  }

  @HttpCode(200)
  @Post(':id/spam-check')
  spamCheck(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.spamCheck(user, id);
  }
}
