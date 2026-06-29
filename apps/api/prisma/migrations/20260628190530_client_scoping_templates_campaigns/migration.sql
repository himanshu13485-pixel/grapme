-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "EmailTemplate" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "Campaign_clientId_idx" ON "Campaign"("clientId");

-- CreateIndex
CREATE INDEX "EmailTemplate_clientId_idx" ON "EmailTemplate"("clientId");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
