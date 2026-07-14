-- Session tracking: IP + user-agent on refresh tokens (carried across rotations),
-- plus an index to look up a user's live sessions quickly.
ALTER TABLE "RefreshToken" ADD COLUMN "ip" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "userAgent" TEXT;

CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
