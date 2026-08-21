import { Role as SalesGateRole } from '@prisma/client';
import { Roles as SalesGateRoles } from '../common/decorators/roles.decorator';
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AiService } from './ai.service';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

class AiSettingsDto {
  @IsOptional() @IsString() apiKey?: string; // '' clears, undefined keeps
  @IsOptional() @IsString() model?: string;
}
class GenerateDto {
  @IsOptional() @IsString() clientName?: string;
  @IsString() context: string;
  @IsOptional() @IsString() tone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(12) monthlyCount?: number;
  @IsOptional() @IsBoolean() includeInitial?: boolean;
  @IsOptional() @IsBoolean() includeFollowup?: boolean;
  @IsOptional() @IsString() namePrefix?: string;
}
class RewriteDto {
  @IsString() subject: string;
  @IsString() bodyHtml: string;
  @IsOptional() @IsString() note?: string;
}

// Admin + sub-admin only. Never clients or salespeople.
@SalesGateRoles(SalesGateRole.SUPER_ADMIN, SalesGateRole.SUB_ADMIN)
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.ai.getSettings(user);
  }

  @Put('settings')
  setSettings(@CurrentUser() user: AuthUser, @Body() dto: AiSettingsDto) {
    return this.ai.setSettings(user, dto);
  }

  /** Verify the key + model with a tiny call (tests the typed key if given, else stored). */
  @Post('settings/test')
  test(@CurrentUser() user: AuthUser, @Body() dto: AiSettingsDto) {
    return this.ai.testKey(user, dto);
  }

  @Post('templates/generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateDto) {
    return this.ai.generateBatch(user, dto);
  }

  @Post('templates/rewrite')
  rewrite(@CurrentUser() user: AuthUser, @Body() dto: RewriteDto) {
    return this.ai.rewrite(user, dto);
  }
}
