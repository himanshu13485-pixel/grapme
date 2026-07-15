-- Reusable Target-Audience templates for LinkedIn campaigns (tenant-wide).
CREATE TABLE "LiAudiencePreset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiAudiencePreset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiAudiencePreset_tenantId_idx" ON "LiAudiencePreset"("tenantId");

ALTER TABLE "LiAudiencePreset" ADD CONSTRAINT "LiAudiencePreset_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
