-- Internal Work: admin-only notes / discussion about clients (never visible to clients).
DO $$ BEGIN
  CREATE TYPE "InternalNoteAudience" AS ENUM ('ALL_STAFF', 'USER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InternalNote" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "bodyHtml"        TEXT NOT NULL,
  "clientId"        TEXT,
  "clientName"      TEXT,
  "audience"        "InternalNoteAudience" NOT NULL DEFAULT 'ALL_STAFF',
  "targetUserId"    TEXT,
  "audienceLabel"   TEXT,
  "status"          TEXT NOT NULL DEFAULT 'DRAFT',
  "postedAt"        TIMESTAMP(3),
  "showInApp"       BOOLEAN NOT NULL DEFAULT true,
  "sendEmail"       BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "createdByName"   TEXT,
  "recipientCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InternalNote_tenantId_createdAt_idx" ON "InternalNote"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "InternalNoteRecipient" (
  "id"        TEXT NOT NULL,
  "noteId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalNoteRecipient_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InternalNoteRecipient_userId_readAt_idx" ON "InternalNoteRecipient"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "InternalNoteRecipient_noteId_idx" ON "InternalNoteRecipient"("noteId");

DO $$ BEGIN
  ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InternalNoteRecipient" ADD CONSTRAINT "InternalNoteRecipient_noteId_fkey"
    FOREIGN KEY ("noteId") REFERENCES "InternalNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InternalNoteRecipient" ADD CONSTRAINT "InternalNoteRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
