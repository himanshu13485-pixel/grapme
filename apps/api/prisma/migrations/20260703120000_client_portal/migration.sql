-- Client self-service panel: CLIENT role + client-login ownership of a profile.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CLIENT';
ALTER TABLE "Client" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
