-- Per-mailbox template variants per sequence stage (index = mailbox rotation position).
ALTER TABLE "SequenceStep" ADD COLUMN "templateIds" JSONB NOT NULL DEFAULT '[]';

-- Backfill: existing single-template stages become a one-element variant list.
UPDATE "SequenceStep"
SET "templateIds" = jsonb_build_array("templateId")
WHERE "templateId" IS NOT NULL;
