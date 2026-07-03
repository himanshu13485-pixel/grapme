-- Per-client plan validity window (days) + when it started.
ALTER TABLE "Client" ADD COLUMN "validityDays" INTEGER;
ALTER TABLE "Client" ADD COLUMN "validityStartAt" TIMESTAMP(3);
