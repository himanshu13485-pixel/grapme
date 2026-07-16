-- "Not accepted" lead status + auto-withdraw support + configurable window.
ALTER TYPE "LiLeadStatus" ADD VALUE IF NOT EXISTS 'NOT_ACCEPTED';

ALTER TABLE "LiLead" ADD COLUMN "unipileInvitationId" TEXT;

ALTER TABLE "LiCampaign" ADD COLUMN "connectionWindowDays" INTEGER NOT NULL DEFAULT 5;
