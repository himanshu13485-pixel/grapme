-- Admin Broadcasts (one-way Notification to clients).

DO $$ BEGIN
  CREATE TYPE "BroadcastAudience" AS ENUM ('ALL', 'CHANNEL', 'PLAN', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Broadcast" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "bodyHtml"        TEXT NOT NULL,
  "signatureHtml"   TEXT,
  "audience"        "BroadcastAudience" NOT NULL DEFAULT 'ALL',
  "channel"         TEXT,
  "plan"            TEXT,
  "clientId"        TEXT,
  "audienceLabel"   TEXT,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "sentAt"          TIMESTAMP(3),
  "showInApp"       BOOLEAN NOT NULL DEFAULT true,
  "sendEmail"       BOOLEAN NOT NULL DEFAULT true,
  "sendWhatsapp"    BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "createdByName"   TEXT,
  "recipientCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Broadcast_tenantId_createdAt_idx" ON "Broadcast"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
  "id"          TEXT NOT NULL,
  "broadcastId" TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "clientId"    TEXT,
  "readAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_userId_readAt_idx" ON "BroadcastRecipient"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_idx" ON "BroadcastRecipient"("broadcastId");

DO $$ BEGIN
  ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey"
    FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
