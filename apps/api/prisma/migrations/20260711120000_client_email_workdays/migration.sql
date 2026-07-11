-- Per-client email send days (0=Sun … 6=Sat). Defaults to Mon–Fri.
ALTER TABLE "Client" ADD COLUMN "workDays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5];

-- Preserve existing behavior: clients that were NOT weekdays-only send all 7 days.
UPDATE "Client" SET "workDays" = ARRAY[0, 1, 2, 3, 4, 5, 6] WHERE "weekdaysOnly" = false;
