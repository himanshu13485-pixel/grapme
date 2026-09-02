import { Module } from '@nestjs/common';
import { UnipileProvider } from './provider/unipile.provider';
import { LiRateGuard } from './provider/li-rate-guard.service';
import { LINKEDIN_PROVIDER } from './provider/linkedin-provider.interface';
import { LiAiService } from './ai/ai.service';
import { LinkedInSubscriptionService } from './subscription/linkedin-subscription.service';
import { LinkedInSubscriptionController } from './subscription/linkedin-subscription.controller';
import { LinkedInAccountsService } from './accounts/linkedin-accounts.service';
import {
  LinkedInAccountsController,
  LinkedInAccountByIdController,
} from './accounts/linkedin-accounts.controller';
import { LinkedInWebhooksController } from './accounts/linkedin-webhooks.controller';
import { LiSchedulerService } from './scheduler/li-scheduler.service';
import { LiOutreachProcessor } from './scheduler/li-outreach.processor';
import { LiCampaignsService } from './campaigns/li-campaigns.service';
import { LiGenerationService } from './campaigns/li-generation.service';
import { LiCampaignsController } from './campaigns/li-campaigns.controller';
import { LiPresetsController } from './campaigns/li-presets.controller';
import { LiOverviewController } from './campaigns/li-overview.controller';
import { LiKnowledgeService } from './knowledge/li-knowledge.service';
import { LiKnowledgeController } from './knowledge/li-knowledge.controller';
import { LiInboxService } from './inbox/li-inbox.service';
import { LiInboxController } from './inbox/li-inbox.controller';
import { LiInboxWebhooksController } from './inbox/li-inbox-webhooks.controller';
import { AiModule } from '../ai/ai.module';

// The worker needs Redis (QueueModule). With QUEUE_ENABLED=false the rest of the
// LinkedIn channel still runs; only campaign execution is idle.
const queueEnabled = process.env.QUEUE_ENABLED !== 'false';

/**
 * LinkedIn Outreach channel — self-contained module added to the aeo platform.
 * Shares Tenant/User/Client via scalar ids; keeps its own subscription, credits,
 * automation engine, campaigns, and (added in later steps) knowledge / inbox.
 */
@Module({
  imports: [AiModule], // unified AI: LinkedIn generation uses the tenant OpenAI key
  providers: [
    LiRateGuard,
    UnipileProvider,
    { provide: LINKEDIN_PROVIDER, useExisting: UnipileProvider },
    LiAiService,
    LinkedInSubscriptionService,
    LinkedInAccountsService,
    LiSchedulerService,
    LiCampaignsService,
    LiGenerationService,
    LiKnowledgeService,
    LiInboxService,
    ...(queueEnabled ? [LiOutreachProcessor] : []),
  ],
  controllers: [
    LinkedInSubscriptionController,
    LinkedInAccountsController,
    LinkedInAccountByIdController,
    LinkedInWebhooksController,
    LiCampaignsController,
    LiPresetsController,
    LiOverviewController,
    LiKnowledgeController,
    LiInboxController,
    LiInboxWebhooksController,
  ],
  exports: [
    LINKEDIN_PROVIDER, LiRateGuard, LiAiService, LinkedInSubscriptionService,
    LinkedInAccountsService, LiSchedulerService, LiCampaignsService,
    LiGenerationService, LiKnowledgeService, LiInboxService,
  ],
})
export class LinkedinModule {}
