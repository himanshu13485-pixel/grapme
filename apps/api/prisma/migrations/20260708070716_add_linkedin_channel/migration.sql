-- CreateEnum
CREATE TYPE "LinkedInAccountStatus" AS ENUM ('PENDING', 'CONNECTED', 'CREDENTIALS', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "LiKnowledgeKind" AS ENUM ('BUSINESS', 'STRATEGY');

-- CreateEnum
CREATE TYPE "LiCampaignType" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "LiCampaignMode" AS ENUM ('REGULAR', 'AI');

-- CreateEnum
CREATE TYPE "LiOutreachType" AS ENUM ('WITH_CONNECTION', 'DIRECT_MESSAGES');

-- CreateEnum
CREATE TYPE "LiCampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "LiStepType" AS ENUM ('CONNECTION_REQUEST', 'MESSAGE');

-- CreateEnum
CREATE TYPE "LiLeadStatus" AS ENUM ('PENDING', 'CONNECTION_PENDING', 'CONNECTED', 'MESSAGED', 'REPLIED', 'BOUNCED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "LiSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "LiMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "LiMessageSource" AS ENUM ('AUTO', 'MANUAL', 'AI');

-- CreateEnum
CREATE TYPE "LiScheduledActionType" AS ENUM ('SEND_CONNECTION', 'CHECK_ACCEPTANCE', 'SEND_MESSAGE');

-- CreateEnum
CREATE TYPE "LiScheduledActionStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LiCreditReason" AS ENUM ('AI_FETCH', 'TOPUP', 'ADJUSTMENT', 'REFUND');

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "plan" SET DEFAULT 'Growth';

-- CreateTable
CREATE TABLE "LinkedInSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "planName" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "creditsBalance" INTEGER NOT NULL DEFAULT 0,
    "validityDays" INTEGER,
    "validityStartAt" TIMESTAMP(3),
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappNumber" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiCreditTransaction" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "LiCreditReason" NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "unipileAccountId" TEXT,
    "status" "LinkedInAccountStatus" NOT NULL DEFAULT 'PENDING',
    "fullName" TEXT,
    "headline" TEXT,
    "profileUrl" TEXT,
    "avatarUrl" TEXT,
    "connectionsCount" INTEGER,
    "dailyInviteLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyMessageLimit" INTEGER NOT NULL DEFAULT 40,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiKnowledgeProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "LiKnowledgeKind" NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "content" JSONB NOT NULL DEFAULT '{}',
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiKnowledgeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiKnowledgeChatMessage" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fieldKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiKnowledgeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "linkedInAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LiCampaignType" NOT NULL DEFAULT 'AUTOMATIC',
    "mode" "LiCampaignMode" NOT NULL DEFAULT 'REGULAR',
    "outreachType" "LiOutreachType" NOT NULL DEFAULT 'WITH_CONNECTION',
    "status" "LiCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "run247" BOOLEAN NOT NULL DEFAULT false,
    "workStartHour" INTEGER NOT NULL DEFAULT 9,
    "workEndHour" INTEGER NOT NULL DEFAULT 18,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "dailyConnectionLimit" INTEGER NOT NULL DEFAULT 20,
    "dailyMessageLimit" INTEGER NOT NULL DEFAULT 20,
    "businessProfileId" TEXT,
    "strategyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiTargetAudienceSpec" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companySizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "jobTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seniorities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyKeywordsInclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyKeywordsExclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personKeywordsInclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "personKeywordsExclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiTargetAudienceSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiSequenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "LiStepType" NOT NULL,
    "waitHours" INTEGER NOT NULL DEFAULT 0,
    "body" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiSequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "company" TEXT,
    "location" TEXT,
    "profileUrl" TEXT,
    "avatarUrl" TEXT,
    "unipileMemberId" TEXT,
    "status" "LiLeadStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "sentiment" "LiSentiment",
    "intent" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiConversation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unipileChatId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "needsReply" BOOLEAN NOT NULL DEFAULT false,
    "lastReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "LiMessageDirection" NOT NULL,
    "source" "LiMessageSource" NOT NULL DEFAULT 'AUTO',
    "body" TEXT NOT NULL,
    "unipileMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiAiFetch" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "intent" TEXT,
    "sentiment" "LiSentiment",
    "enrichment" JSONB,
    "draftReply" TEXT,
    "creditCost" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiAiFetch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiScheduledAction" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LiScheduledActionType" NOT NULL,
    "status" "LiScheduledActionStatus" NOT NULL DEFAULT 'PENDING',
    "stepOrder" INTEGER,
    "runAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiScheduledAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInSubscription_clientId_key" ON "LinkedInSubscription"("clientId");

-- CreateIndex
CREATE INDEX "LinkedInSubscription_tenantId_idx" ON "LinkedInSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "LiCreditTransaction_subscriptionId_idx" ON "LiCreditTransaction"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_unipileAccountId_key" ON "LinkedInAccount"("unipileAccountId");

-- CreateIndex
CREATE INDEX "LinkedInAccount_tenantId_idx" ON "LinkedInAccount"("tenantId");

-- CreateIndex
CREATE INDEX "LinkedInAccount_clientId_idx" ON "LinkedInAccount"("clientId");

-- CreateIndex
CREATE INDEX "LinkedInAccount_status_idx" ON "LinkedInAccount"("status");

-- CreateIndex
CREATE INDEX "LiKnowledgeProfile_clientId_kind_idx" ON "LiKnowledgeProfile"("clientId", "kind");

-- CreateIndex
CREATE INDEX "LiKnowledgeProfile_parentId_idx" ON "LiKnowledgeProfile"("parentId");

-- CreateIndex
CREATE INDEX "LiKnowledgeChatMessage_profileId_idx" ON "LiKnowledgeChatMessage"("profileId");

-- CreateIndex
CREATE INDEX "LiCampaign_tenantId_idx" ON "LiCampaign"("tenantId");

-- CreateIndex
CREATE INDEX "LiCampaign_clientId_status_idx" ON "LiCampaign"("clientId", "status");

-- CreateIndex
CREATE INDEX "LiCampaign_linkedInAccountId_idx" ON "LiCampaign"("linkedInAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LiTargetAudienceSpec_campaignId_key" ON "LiTargetAudienceSpec"("campaignId");

-- CreateIndex
CREATE INDEX "LiSequenceStep_campaignId_idx" ON "LiSequenceStep"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LiSequenceStep_campaignId_order_key" ON "LiSequenceStep"("campaignId", "order");

-- CreateIndex
CREATE INDEX "LiLead_campaignId_status_idx" ON "LiLead"("campaignId", "status");

-- CreateIndex
CREATE INDEX "LiLead_status_idx" ON "LiLead"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LiConversation_leadId_key" ON "LiConversation"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LiConversation_unipileChatId_key" ON "LiConversation"("unipileChatId");

-- CreateIndex
CREATE INDEX "LiConversation_needsReply_idx" ON "LiConversation"("needsReply");

-- CreateIndex
CREATE UNIQUE INDEX "LiMessage_unipileMessageId_key" ON "LiMessage"("unipileMessageId");

-- CreateIndex
CREATE INDEX "LiMessage_conversationId_idx" ON "LiMessage"("conversationId");

-- CreateIndex
CREATE INDEX "LiAiFetch_leadId_idx" ON "LiAiFetch"("leadId");

-- CreateIndex
CREATE INDEX "LiScheduledAction_status_runAt_idx" ON "LiScheduledAction"("status", "runAt");

-- CreateIndex
CREATE INDEX "LiScheduledAction_leadId_idx" ON "LiScheduledAction"("leadId");

-- AddForeignKey
ALTER TABLE "LiCreditTransaction" ADD CONSTRAINT "LiCreditTransaction_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "LinkedInSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiKnowledgeProfile" ADD CONSTRAINT "LiKnowledgeProfile_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LiKnowledgeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiKnowledgeChatMessage" ADD CONSTRAINT "LiKnowledgeChatMessage_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "LiKnowledgeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiCampaign" ADD CONSTRAINT "LiCampaign_linkedInAccountId_fkey" FOREIGN KEY ("linkedInAccountId") REFERENCES "LinkedInAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiCampaign" ADD CONSTRAINT "LiCampaign_businessProfileId_fkey" FOREIGN KEY ("businessProfileId") REFERENCES "LiKnowledgeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiCampaign" ADD CONSTRAINT "LiCampaign_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "LiKnowledgeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiTargetAudienceSpec" ADD CONSTRAINT "LiTargetAudienceSpec_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LiCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiSequenceStep" ADD CONSTRAINT "LiSequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LiCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiLead" ADD CONSTRAINT "LiLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "LiCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiConversation" ADD CONSTRAINT "LiConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LiLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiMessage" ADD CONSTRAINT "LiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "LiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiAiFetch" ADD CONSTRAINT "LiAiFetch_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LiLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiScheduledAction" ADD CONSTRAINT "LiScheduledAction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "LiLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
