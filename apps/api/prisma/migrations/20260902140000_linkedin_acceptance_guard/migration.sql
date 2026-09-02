-- Acceptance-rate health guard: pause a campaign whose invites are being ignored.
-- A low acceptance rate is what LinkedIn penalises hardest, and it comes from
-- targeting/copy rather than from send pacing.
ALTER TABLE "LiCampaign" ADD COLUMN "minAcceptanceRate" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "LiCampaign" ADD COLUMN "acceptanceGateFrom" TIMESTAMP(3);
ALTER TABLE "LiCampaign" ADD COLUMN "pausedReason" TEXT;

-- Existing running campaigns start their sample now, not from their whole history.
UPDATE "LiCampaign" SET "acceptanceGateFrom" = CURRENT_TIMESTAMP WHERE "status" = 'RUNNING';
