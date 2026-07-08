import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { MailboxesModule } from './mailboxes/mailboxes.module';
import { ContactsModule } from './contacts/contacts.module';
import { TemplatesModule } from './templates/templates.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SendingModule } from './sending/sending.module';
import { TrackingModule } from './tracking/tracking.module';
import { ReportsModule } from './reports/reports.module';
import { SubAdminsModule } from './sub-admins/sub-admins.module';
import { CreditsModule } from './credits/credits.module';
import { MessagesModule } from './messages/messages.module';
import { DeliverabilityModule } from './deliverability/deliverability.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ProgramsModule } from './programs/programs.module';
import { PlansModule } from './plans/plans.module';
import { GreetingsModule } from './greetings/greetings.module';
import { AssetsModule } from './assets/assets.module';
import { LinkedinModule } from './linkedin/linkedin.module';
import { LiPortalModule } from './linkedin/portal/li-portal.module';
import { HealthController } from './health.controller';

// The sending engine needs Redis. Set QUEUE_ENABLED=false to run the rest of
// the platform (auth, campaigns, approvals, …) with only Postgres.
const queueEnabled = process.env.QUEUE_ENABLED !== 'false';
const engineModules = queueEnabled ? [QueueModule, SendingModule] : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    ApprovalsModule,
    MailboxesModule,
    ContactsModule,
    TemplatesModule,
    CampaignsModule,
    TrackingModule,
    ReportsModule,
    SubAdminsModule,
    CreditsModule,
    MessagesModule,
    DeliverabilityModule,
    ComplianceModule,
    ProgramsModule,
    PlansModule,
    GreetingsModule,
    AssetsModule,
    LinkedinModule,
    LiPortalModule,
    ...engineModules,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
