-- Monthly "email arrangement" ops steps + first-save notify guard + reminder cadence.
ALTER TYPE "SetupGroup" ADD VALUE IF NOT EXISTS 'MONTHLY';

ALTER TABLE "Client" ADD COLUMN "serviceMonths" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Client" ADD COLUMN "setupNotifiedAt" TIMESTAMP(3);

ALTER TABLE "ClientSetupStep" ADD COLUMN "monthIndex" INTEGER;
ALTER TABLE "ClientSetupStep" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
