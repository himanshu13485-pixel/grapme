-- Warm-up ramp for LinkedIn campaigns (additive).
ALTER TABLE "LiCampaign" ADD COLUMN "warmupEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LiCampaign" ADD COLUMN "warmupStartLimit" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "LiCampaign" ADD COLUMN "warmupDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "LiCampaign" ADD COLUMN "warmupStartedAt" TIMESTAMP(3);
