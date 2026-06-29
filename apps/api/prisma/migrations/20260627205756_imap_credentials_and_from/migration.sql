-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "imapCredentialsEncrypted" TEXT,
ADD COLUMN     "imapUsername" TEXT;

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "fromAddress" TEXT;
