-- Link outbound cohort sends to their cohort so per-cohort reports can aggregate.
ALTER TABLE "EmailMessage" ADD COLUMN "cohortId" TEXT;
CREATE INDEX "EmailMessage_cohortId_idx" ON "EmailMessage"("cohortId");
