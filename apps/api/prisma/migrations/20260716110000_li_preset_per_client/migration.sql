-- Scope audience presets to a single client workspace (was tenant-wide).
-- Existing tenant-wide presets can't be mapped to a client, so drop them.
DELETE FROM "LiAudiencePreset";

DROP INDEX IF EXISTS "LiAudiencePreset_tenantId_idx";

ALTER TABLE "LiAudiencePreset" ADD COLUMN "clientId" TEXT NOT NULL;

CREATE INDEX "LiAudiencePreset_clientId_idx" ON "LiAudiencePreset"("clientId");

ALTER TABLE "LiAudiencePreset" ADD CONSTRAINT "LiAudiencePreset_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
