-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ContactList" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

-- CreateIndex
CREATE INDEX "ContactList_clientId_idx" ON "ContactList"("clientId");

-- AddForeignKey
ALTER TABLE "ContactList" ADD CONSTRAINT "ContactList_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
