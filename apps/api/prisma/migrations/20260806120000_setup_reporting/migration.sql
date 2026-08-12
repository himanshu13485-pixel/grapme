-- Client-workspace setup reporting (onboarding tracker).
CREATE TYPE "SetupGroup" AS ENUM ('GENERAL', 'EMAIL', 'LINKEDIN');
CREATE TYPE "SetupStatus" AS ENUM ('NOT_STARTED', 'STARTED', 'FINISHED');

CREATE TABLE "SetupStepTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "group" "SetupGroup" NOT NULL DEFAULT 'GENERAL',
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SetupStepTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SetupStepTemplate_tenantId_key_key" ON "SetupStepTemplate"("tenantId", "key");
CREATE INDEX "SetupStepTemplate_tenantId_idx" ON "SetupStepTemplate"("tenantId");

CREATE TABLE "ClientSetupStep" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "templateKey" TEXT,
  "label" TEXT NOT NULL,
  "group" "SetupGroup" NOT NULL DEFAULT 'GENERAL',
  "order" INTEGER NOT NULL DEFAULT 0,
  "status" "SetupStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "assigneeUserId" TEXT,
  "assigneeName" TEXT,
  "assigneeEmail" TEXT,
  "assigneeRole" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientSetupStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientSetupStep_clientId_templateKey_key" ON "ClientSetupStep"("clientId", "templateKey");
CREATE INDEX "ClientSetupStep_clientId_idx" ON "ClientSetupStep"("clientId");
CREATE INDEX "ClientSetupStep_tenantId_idx" ON "ClientSetupStep"("tenantId");
ALTER TABLE "ClientSetupStep" ADD CONSTRAINT "ClientSetupStep_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClientSetupEvent" (
  "id" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "status" "SetupStatus" NOT NULL,
  "actorUserId" TEXT,
  "actorName" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientSetupEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientSetupEvent_stepId_idx" ON "ClientSetupEvent"("stepId");
ALTER TABLE "ClientSetupEvent" ADD CONSTRAINT "ClientSetupEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ClientSetupStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
