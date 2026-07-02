-- Sub-admin: assignable clients + a delete-permission flag.
ALTER TABLE "SubAdminAssignment" ADD COLUMN "assignedClientId" TEXT;
ALTER TABLE "SubAdminAssignment"
  ADD CONSTRAINT "SubAdminAssignment_assignedClientId_fkey"
  FOREIGN KEY ("assignedClientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "canDelete" BOOLEAN NOT NULL DEFAULT false;
