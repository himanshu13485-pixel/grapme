-- LinkedIn human-likeness: per-step message variants, randomized follow-up count,
-- grace window, and the CAMPAIGN_COMPLETED terminal lead state.

-- New enum values (safe/idempotent). These are NOT referenced as column defaults in
-- this migration, so they can be added alongside the column changes.
ALTER TYPE "LiLeadStatus" ADD VALUE IF NOT EXISTS 'CAMPAIGN_COMPLETED';
ALTER TYPE "LiScheduledActionType" ADD VALUE IF NOT EXISTS 'COMPLETE_LEAD';

-- Per-step alternate wordings (random pick per lead at send time).
ALTER TABLE "LiSequenceStep" ADD COLUMN "variants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Campaign-level variation knobs.
ALTER TABLE "LiCampaign" ADD COLUMN "followUpMin" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LiCampaign" ADD COLUMN "followUpMax" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LiCampaign" ADD COLUMN "graceHours" INTEGER NOT NULL DEFAULT 96;

-- Per-lead assigned message count (null = all steps).
ALTER TABLE "LiLead" ADD COLUMN "assignedMessages" INTEGER;
