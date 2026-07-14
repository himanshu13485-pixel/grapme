-- Force-logout cutoff: access tokens issued before this are rejected immediately.
ALTER TABLE "User" ADD COLUMN "sessionsRevokedAt" TIMESTAMP(3);
