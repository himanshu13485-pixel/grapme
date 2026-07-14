-- Subscription renewal history: one period per plan/validity window.

CREATE TABLE "SubscriptionPeriod" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "validityDays" INTEGER NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endAt" TIMESTAMP(3) NOT NULL,
  "amount" INTEGER,
  "currency" TEXT,
  "source" TEXT NOT NULL DEFAULT 'admin',
  "endedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionPeriod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SubscriptionPeriod_tenantId_idx" ON "SubscriptionPeriod"("tenantId");
CREATE INDEX "SubscriptionPeriod_clientId_startAt_idx" ON "SubscriptionPeriod"("clientId", "startAt");
CREATE INDEX "SubscriptionPeriod_endAt_idx" ON "SubscriptionPeriod"("endAt");

-- Backfill: seed the current period for every client that already has a validity window.
INSERT INTO "SubscriptionPeriod" ("id", "tenantId", "clientId", "plan", "validityDays", "startAt", "endAt", "source", "createdAt")
SELECT gen_random_uuid(), "tenantId", "id", COALESCE("plan", '—'), "validityDays", "validityStartAt",
       "validityStartAt" + ("validityDays" || ' days')::interval, 'backfill', CURRENT_TIMESTAMP
FROM "Client"
WHERE "validityDays" IS NOT NULL AND "validityDays" > 0 AND "validityStartAt" IS NOT NULL;
