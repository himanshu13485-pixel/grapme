-- Uploaded images (template inline images), stored in the DB and served by id.
CREATE TABLE "Asset" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_tenantId_idx" ON "Asset"("tenantId");
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
