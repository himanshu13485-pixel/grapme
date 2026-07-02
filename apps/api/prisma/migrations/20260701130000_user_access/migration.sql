-- Sub-admin access control: full access flag + allowed module keys.
ALTER TABLE "User" ADD COLUMN "fullAccess" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "accessModules" JSONB NOT NULL DEFAULT '[]';
