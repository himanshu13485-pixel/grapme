-- Onboarding stopwatch on the Reporting client box (staff-only).
ALTER TABLE "Client" ADD COLUMN "setupStartedAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "setupFinishedAt" TIMESTAMP(3);
