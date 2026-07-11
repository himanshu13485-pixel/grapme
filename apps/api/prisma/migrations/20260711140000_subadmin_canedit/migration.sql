-- Sub-admin: separate "edit actions" permission (defaults on so existing sub-admins keep edit access).
ALTER TABLE "User" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT true;
