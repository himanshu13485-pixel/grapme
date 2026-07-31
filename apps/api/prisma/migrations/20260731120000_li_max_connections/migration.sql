-- Upper bound for the lead-quality connection gate (skip maxed-out profiles that can't
-- accept invites). Idempotent for safe re-runs.
ALTER TABLE "LiCampaign" ADD COLUMN IF NOT EXISTS "maxConnections" INTEGER NOT NULL DEFAULT 0;
