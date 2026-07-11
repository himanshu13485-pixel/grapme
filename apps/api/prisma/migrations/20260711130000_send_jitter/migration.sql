-- Email: per-client send stagger (random 0…N seconds added to each email send).
ALTER TABLE "Client" ADD COLUMN "emailJitterSeconds" INTEGER NOT NULL DEFAULT 20;

-- LinkedIn: per-campaign random gap between actions (min/max seconds).
ALTER TABLE "LiCampaign" ADD COLUMN "jitterMinSeconds" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "LiCampaign" ADD COLUMN "jitterMaxSeconds" INTEGER NOT NULL DEFAULT 90;
