-- Per-cohort sequences: a sequence step can belong to a cohort (its own plan)
-- or stay null (the client's default template).
ALTER TABLE "SequenceStep" ADD COLUMN "cohortId" TEXT;

-- The old per-client uniqueness blocks many cohorts sharing clientId+stageOrder.
DROP INDEX IF EXISTS "SequenceStep_clientId_stageOrder_key";

CREATE INDEX "SequenceStep_clientId_idx" ON "SequenceStep"("clientId");
CREATE INDEX "SequenceStep_cohortId_idx" ON "SequenceStep"("cohortId");

ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;
