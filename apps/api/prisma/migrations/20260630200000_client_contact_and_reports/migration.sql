-- Client contact details + scheduled email-report settings.
ALTER TABLE "Client" ADD COLUMN "contactPerson" TEXT;
ALTER TABLE "Client" ADD COLUMN "email" TEXT;
ALTER TABLE "Client" ADD COLUMN "reportDaily" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "reportWeekly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "reportMonthly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "reportHour" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "Client" ADD COLUMN "reportLastDailyAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "reportLastWeeklyAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN "reportLastMonthlyAt" TIMESTAMP(3);
