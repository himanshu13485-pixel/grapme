-- Per-client operation contacts + monthly campaign-data reminder guard.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "operationContacts" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "lastCampaignReminderAt" TIMESTAMP(3);
