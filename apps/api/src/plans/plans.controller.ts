import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { PlansService } from './plans.service';
import { Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  AuthUser,
} from '../common/decorators/current-user.decorator';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  /** Public plan list for the marketing site (grapme.com/pricing). No auth. */
  @Public()
  @Get('public')
  publicList() {
    return this.plans.publicList();
  }

  /** All roles can read plans (they drive pickers/filters everywhere). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.plans.list(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: { name: string; color?: string },
  ) {
    return this.plans.create(user, dto.name, dto.color);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: {
      name?: string; color?: string; sortOrder?: number;
      emailEnabled?: boolean; linkedInEnabled?: boolean;
      validityDays?: number | null;
      emailCredits?: number; linkedInCredits?: number;
      mailboxLimit?: number; seatLimit?: number;
      emailCampaignLimit?: number; linkedInCampaignLimit?: number;
      pricing?: unknown;
      yearlyEntitlements?: unknown;
      cardStyle?: string;
      features?: unknown;
      popular?: boolean;
    },
  ) {
    return this.plans.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.plans.remove(user, id);
  }
}
