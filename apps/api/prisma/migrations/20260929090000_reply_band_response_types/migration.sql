-- Reply band shown on staff dashboards (off by default, so nothing changes
-- until the super admin turns it on), and saved Response Type examples.
ALTER TABLE "Tenant" ADD COLUMN "replyBoostEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "replyBoostMinPct" DOUBLE PRECISION NOT NULL DEFAULT 5.5;
ALTER TABLE "Tenant" ADD COLUMN "replyBoostMaxPct" DOUBLE PRECISION NOT NULL DEFAULT 7.5;

CREATE TABLE "ReplyBoostState" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "shownReplies" INTEGER NOT NULL DEFAULT 0,
  "lastSent" INTEGER NOT NULL DEFAULT 0,
  "targetPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReplyBoostState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReplyBoostState_tenantId_scopeKey_key" ON "ReplyBoostState"("tenantId", "scopeKey");
CREATE INDEX "ReplyBoostState_tenantId_idx" ON "ReplyBoostState"("tenantId");

CREATE TABLE "ResponseType" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "messageId" TEXT,
  "category" TEXT NOT NULL,
  "fromAddress" TEXT,
  "subject" TEXT,
  "body" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResponseType_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ResponseType_tenantId_idx" ON "ResponseType"("tenantId");
