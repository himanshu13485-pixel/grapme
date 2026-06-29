-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "autoCohortDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "autoCohortEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoCohortListId" TEXT,
ADD COLUMN     "lastAutoCohortAt" TIMESTAMP(3);
