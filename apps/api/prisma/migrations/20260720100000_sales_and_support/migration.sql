-- Sales Person + Client Support features.

-- 1) New SALES role. Safe to add without using it in this same migration.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES';

-- 2) Per-user alert preferences (in-app is always on; transactional mail ignores these).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false;

-- 3) Link a client to their salesperson.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "salesPersonId" TEXT;
CREATE INDEX IF NOT EXISTS "Client_salesPersonId_idx" ON "Client"("salesPersonId");
DO $$ BEGIN
  ALTER TABLE "Client"
    ADD CONSTRAINT "Client_salesPersonId_fkey"
    FOREIGN KEY ("salesPersonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4) Client Support enums.
DO $$ BEGIN
  CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'ANSWERED', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SupportSatisfaction" AS ENUM ('SATISFIED', 'NOT_SATISFIED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "SupportReplyRole" AS ENUM ('CLIENT', 'SUPPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Tickets.
CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"               TEXT NOT NULL,
  "tenantId"         TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "clientId"         TEXT,
  "subject"          TEXT NOT NULL,
  "category"         TEXT,
  "status"           "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "assignedToId"     TEXT,
  "satisfaction"     "SupportSatisfaction",
  "satisfactionNote" TEXT,
  "lastReplyAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReplyRole"    "SupportReplyRole" NOT NULL DEFAULT 'CLIENT',
  "escalatedAt"      TIMESTAMP(3),
  "escalatedById"    TEXT,
  "escalationNote"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportTicket_tenantId_status_idx" ON "SupportTicket"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx" ON "SupportTicket"("userId");
CREATE INDEX IF NOT EXISTS "SupportTicket_assignedToId_idx" ON "SupportTicket"("assignedToId");
CREATE INDEX IF NOT EXISTS "SupportTicket_clientId_idx" ON "SupportTicket"("clientId");

-- 6) Messages (attachment stored as a private DB blob).
CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id"             TEXT NOT NULL,
  "ticketId"       TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "attachmentData" BYTEA,
  "attachmentName" TEXT,
  "attachmentMime" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_idx" ON "SupportMessage"("ticketId");

-- 7) Foreign keys for the support tables.
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_escalatedById_fkey"
    FOREIGN KEY ("escalatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
