-- Background drip-sourcer config for LinkedIn campaigns (additive).
ALTER TABLE "LiCampaign" ADD COLUMN "dripEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LiCampaign" ADD COLUMN "dripDailyTarget" INTEGER NOT NULL DEFAULT 25;
ALTER TABLE "LiCampaign" ADD COLUMN "dripBuffer" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "LiCampaign" ADD COLUMN "lastDripAt" TIMESTAMP(3);
