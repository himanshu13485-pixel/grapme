-- Sub-cohorts: several cohorts can share one month (#2A, #2B, …).
-- Null = the month has a single cohort and keeps its plain "#2" label, so every
-- existing (and running) cohort is untouched by this migration.
ALTER TABLE "Cohort" ADD COLUMN "subIndex" INTEGER;
