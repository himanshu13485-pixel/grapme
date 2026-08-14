-- Duplicate-email audit for contact imports (report + download).
CREATE TABLE "DuplicateEmail" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fileName" TEXT,
    "importJobId" TEXT,
    "newListId" TEXT,
    "newListName" TEXT,
    "newCompany" TEXT,
    "existingListNames" TEXT,
    "existingCompany" TEXT,
    "existingClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DuplicateEmail_tenantId_idx" ON "DuplicateEmail"("tenantId");
CREATE INDEX "DuplicateEmail_tenantId_createdAt_idx" ON "DuplicateEmail"("tenantId", "createdAt");

ALTER TABLE "DuplicateEmail" ADD CONSTRAINT "DuplicateEmail_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
