import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { LiKnowledgeService } from './li-knowledge.service';

class CreateProfileDto { @IsString() @MinLength(2) name!: string; }
class AnswerDto { @IsString() @MinLength(1) text!: string; }
class SetFieldDto { @IsString() key!: string; @IsString() value!: string; }

/** Admin-only LinkedIn AI Knowledge (business profiles + strategies + chat interview). */
@Controller('linkedin')
@Roles(Role.SUPER_ADMIN, Role.SUB_ADMIN)
export class LiKnowledgeController {
  constructor(private readonly knowledge: LiKnowledgeService) {}

  @Get('clients/:clientId/business-profiles')
  listBusiness(@Param('clientId') clientId: string) {
    return this.knowledge.listBusinessProfiles(clientId);
  }

  @Post('clients/:clientId/business-profiles')
  createBusiness(@CurrentUser() user: AuthUser, @Param('clientId') clientId: string, @Body() dto: CreateProfileDto) {
    return this.knowledge.createBusinessProfile(user.tenantId, clientId, dto.name);
  }

  @Get('clients/:clientId/knowledge-stats')
  stats(@Param('clientId') clientId: string) {
    return this.knowledge.clientStats(clientId);
  }

  @Get('business-profiles/:id/strategies')
  listStrategies(@Param('id') id: string) {
    return this.knowledge.listStrategies(id);
  }

  @Post('business-profiles/:id/strategies')
  createStrategy(@Param('id') id: string, @Body() dto: CreateProfileDto) {
    return this.knowledge.createStrategy(id, dto.name);
  }

  @Get('knowledge-profiles/:id')
  get(@Param('id') id: string) {
    return this.knowledge.get(id);
  }

  @Get('knowledge-profiles/:id/details')
  details(@Param('id') id: string) {
    return this.knowledge.details(id);
  }

  @Get('knowledge-profiles/:id/chat')
  chat(@Param('id') id: string) {
    return this.knowledge.chat(id);
  }

  @Post('knowledge-profiles/:id/chat')
  answer(@Param('id') id: string, @Body() dto: AnswerDto) {
    return this.knowledge.answer(id, dto.text);
  }

  @Post('knowledge-profiles/:id/field')
  setField(@Param('id') id: string, @Body() dto: SetFieldDto) {
    return this.knowledge.setField(id, dto.key, dto.value);
  }

  @Delete('knowledge-profiles/:id')
  remove(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }
}
