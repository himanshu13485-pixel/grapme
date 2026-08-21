-- Tenant-level OpenAI settings for the AI template assistant (key encrypted at rest).
ALTER TABLE "Tenant" ADD COLUMN "aiApiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "aiModel" TEXT;
