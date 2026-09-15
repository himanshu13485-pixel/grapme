-- Removing a LinkedIn account used to delete every campaign on it (leads, sequence,
-- schedule, history). Campaigns now outlive their account: the link is nullable and
-- deleting the account detaches them (SET NULL) so they can be re-attached later.
ALTER TABLE "LiCampaign" DROP CONSTRAINT "LiCampaign_linkedInAccountId_fkey";
ALTER TABLE "LiCampaign" ALTER COLUMN "linkedInAccountId" DROP NOT NULL;
ALTER TABLE "LiCampaign" ADD CONSTRAINT "LiCampaign_linkedInAccountId_fkey"
  FOREIGN KEY ("linkedInAccountId") REFERENCES "LinkedInAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
