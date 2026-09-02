-- Per-seat proxy / country. LinkedIn weighs login location, so a seat reached from a
-- different country than its owner normally uses draws checkpoints regardless of pacing.
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyCountry" TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyHost" TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyPort" INTEGER;
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyProtocol" TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyUsername" TEXT;
-- Encrypted at rest with CREDENTIAL_ENCRYPTION_KEY; never returned by the API.
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyPassword" TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN "proxyAppliedAt" TIMESTAMP(3);
