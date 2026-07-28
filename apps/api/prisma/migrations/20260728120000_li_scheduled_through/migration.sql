-- Daily-pull scheduler idempotency marker on LiCampaign. Idempotent for safe re-runs.
ALTER TABLE "LiCampaign" ADD COLUMN IF NOT EXISTS "scheduledThrough" TIMESTAMP(3);
