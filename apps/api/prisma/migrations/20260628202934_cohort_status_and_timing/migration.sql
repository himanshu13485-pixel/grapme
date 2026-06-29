-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "sendWindowEnd" INTEGER NOT NULL DEFAULT 17,
ADD COLUMN     "sendWindowStart" INTEGER NOT NULL DEFAULT 9,
ADD COLUMN     "stageIntervalJitterDays" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Cohort" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "status" "CohortStatus" NOT NULL DEFAULT 'RUNNING';
