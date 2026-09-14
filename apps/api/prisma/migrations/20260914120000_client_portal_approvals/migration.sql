-- Client-portal approvals beyond templates.
-- New cohorts a client creates start PENDING (the engine only sends RUNNING
-- cohorts), and sequence / settings / cohort stop-delete requests are held as
-- ClientChangeRequest rows until an admin approves them. Existing cohorts are
-- untouched, so everything currently running keeps running.
ALTER TYPE "CohortStatus" ADD VALUE 'PENDING';
ALTER TYPE "ApprovalEntity" ADD VALUE 'COHORT';
ALTER TYPE "ApprovalEntity" ADD VALUE 'CLIENT_CHANGE';

CREATE TYPE "ClientChangeKind" AS ENUM ('SEQUENCE', 'COHORT_SEQUENCE', 'SETTINGS', 'COHORT_STOP', 'COHORT_DELETE');

CREATE TABLE "ClientChangeRequest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "kind" "ClientChangeKind" NOT NULL,
  "targetId" TEXT,
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientChangeRequest_tenantId_idx" ON "ClientChangeRequest"("tenantId");
CREATE INDEX "ClientChangeRequest_clientId_kind_targetId_idx" ON "ClientChangeRequest"("clientId", "kind", "targetId");
