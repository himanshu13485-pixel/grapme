-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'REPLIED', 'STOPPED', 'COMPLETED');

-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "rotationOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'GROWTH',
    "termStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monthlyQuota" INTEGER NOT NULL DEFAULT 100,
    "dailyBatchSize" INTEGER NOT NULL DEFAULT 10,
    "batchWindowDays" INTEGER NOT NULL DEFAULT 10,
    "stageIntervalDays" INTEGER NOT NULL DEFAULT 10,
    "followUpCount" INTEGER NOT NULL DEFAULT 4,
    "weekdaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL,
    "templateId" TEXT,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthIndex" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "daySlot" INTEGER NOT NULL DEFAULT 1,
    "nextTouchAt" TIMESTAMP(3) NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_tenantId_idx" ON "Client"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_clientId_stageOrder_key" ON "SequenceStep"("clientId", "stageOrder");

-- CreateIndex
CREATE INDEX "Cohort_clientId_idx" ON "Cohort"("clientId");

-- CreateIndex
CREATE INDEX "Enrollment_tenantId_idx" ON "Enrollment"("tenantId");

-- CreateIndex
CREATE INDEX "Enrollment_status_nextTouchAt_idx" ON "Enrollment"("status", "nextTouchAt");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_cohortId_contactId_key" ON "Enrollment"("cohortId", "contactId");

-- CreateIndex
CREATE INDEX "EmailAccount_clientId_idx" ON "EmailAccount"("clientId");

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
