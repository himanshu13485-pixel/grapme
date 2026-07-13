-- Soft-delete timestamp for LinkedIn campaigns (Deleted tab / auto-purge after 30 days).
ALTER TABLE "LiCampaign" ADD COLUMN "deletedAt" TIMESTAMP(3);
