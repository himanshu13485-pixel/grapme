-- Gated client login-email change: held until the client confirms via the emailed
-- link OR an admin approves it in the queue.

ALTER TYPE "ApprovalEntity" ADD VALUE IF NOT EXISTS 'CLIENT_LOGIN_EMAIL';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pendingEmailTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pendingEmailExpires" TIMESTAMP(3);
