-- Work / Meetings / Notification board: two-way threaded updates between the
-- agency and each client, plus a bell deep-link on the existing Notification.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "UpdateType" AS ENUM ('WORK', 'MEETING', 'NOTIFICATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Bell deep link on the existing per-user Notification feed.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "link" TEXT;
-- Index unread lookups by (userId, read); replaces the old (userId)-only index.
CREATE INDEX IF NOT EXISTS "Notification_userId_read_idx" ON "Notification"("userId", "read");
DROP INDEX IF EXISTS "Notification_userId_idx";

-- CreateTable UpdateThread
CREATE TABLE "UpdateThread" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "type" "UpdateType" NOT NULL DEFAULT 'WORK',
  "title" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "authorRole" "Role" NOT NULL,
  "authorName" TEXT NOT NULL,
  "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
  "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UpdateThread_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UpdateThread_tenantId_type_idx" ON "UpdateThread"("tenantId", "type");
CREATE INDEX "UpdateThread_clientId_idx" ON "UpdateThread"("clientId");
CREATE INDEX "UpdateThread_lastActivityAt_idx" ON "UpdateThread"("lastActivityAt");

-- CreateTable UpdateReply
CREATE TABLE "UpdateReply" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "authorRole" "Role" NOT NULL,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UpdateReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UpdateReply_threadId_idx" ON "UpdateReply"("threadId");
ALTER TABLE "UpdateReply" ADD CONSTRAINT "UpdateReply_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "UpdateThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
