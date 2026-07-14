-- Subscription end date as a Postgres GENERATED column, so it always stays in sync
-- with validityStartAt + validityDays (no application write-site changes needed).
-- Enables the Client Workspace "Expired" status filter and date-wise subscription filters.
ALTER TABLE "Client"
  ADD COLUMN "validityEndAt" TIMESTAMP(3)
  GENERATED ALWAYS AS (
    CASE
      WHEN "validityStartAt" IS NOT NULL AND "validityDays" IS NOT NULL AND "validityDays" > 0
      THEN "validityStartAt" + make_interval(days => "validityDays")
      ELSE NULL
    END
  ) STORED;

CREATE INDEX "Client_validityEndAt_idx" ON "Client"("validityEndAt");
