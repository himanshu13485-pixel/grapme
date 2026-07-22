-- Conditional follow-up steps: when a MESSAGE step fires vs. the connection outcome.
DO $$ BEGIN
  CREATE TYPE "LiStepCondition" AS ENUM ('ANY', 'IF_ACCEPTED', 'IF_NOT_ACCEPTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "LiSequenceStep" ADD COLUMN IF NOT EXISTS "condition" "LiStepCondition" NOT NULL DEFAULT 'ANY';
