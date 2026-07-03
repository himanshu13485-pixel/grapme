-- Tenant-defined plan names, driving every plan picker/filter.
CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_tenantId_name_key" ON "Plan"("tenantId", "name");
CREATE INDEX "Plan_tenantId_idx" ON "Plan"("tenantId");
ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the three defaults for every existing tenant (id derived from name so
-- re-runs are idempotent via the unique index).
INSERT INTO "Plan" ("id", "tenantId", "name", "sortOrder")
SELECT md5(t."id" || '|' || p.name), t."id", p.name, p.ord
FROM "Tenant" t
CROSS JOIN (VALUES ('Growth', 0), ('Growth Plus', 1), ('Enterprise', 2)) AS p(name, ord)
ON CONFLICT DO NOTHING;

-- Normalize existing client plan codes to the human labels used going forward.
UPDATE "Client" SET "plan" = 'Growth'      WHERE "plan" = 'GROWTH';
UPDATE "Client" SET "plan" = 'Growth Plus' WHERE "plan" IN ('GROWTH_PLUS', 'GROWTH PLUS');
UPDATE "Client" SET "plan" = 'Enterprise'  WHERE "plan" = 'ENTERPRISE';
