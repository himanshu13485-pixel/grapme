ALTER TABLE "Tenant" ADD COLUMN "paymentMode" TEXT NOT NULL DEFAULT 'MANUAL';

CREATE TABLE "PlanUpgradeRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestedPlan" TEXT NOT NULL,
    "currency" TEXT,
    "period" TEXT NOT NULL DEFAULT 'monthly',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanUpgradeRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanUpgradeRequest_tenantId_status_idx" ON "PlanUpgradeRequest"("tenantId", "status");
CREATE INDEX "PlanUpgradeRequest_clientId_idx" ON "PlanUpgradeRequest"("clientId");
