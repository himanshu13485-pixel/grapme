-- Lead-quality gate: campaign minConnections threshold + per-lead connection count.
-- Idempotent for safe re-runs.
ALTER TABLE "LiCampaign" ADD COLUMN IF NOT EXISTS "minConnections" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LiLead" ADD COLUMN IF NOT EXISTS "connectionsCount" INTEGER;
