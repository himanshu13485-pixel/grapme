-- LinkedIn rate safety: per-seat profile-read budget + auto-pause bookkeeping.
-- LinkedIn restricts accounts that read a high volume of profile data; these
-- columns let the engine meter and hard-cap that per seat.
ALTER TABLE "LinkedInAccount" ADD COLUMN "dailyProfileLimit" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "LinkedInAccount" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "LinkedInAccount" ADD COLUMN "pausedAt" TIMESTAMP(3);

CREATE TABLE "LiApiUsage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "profileCalls" INTEGER NOT NULL DEFAULT 0,
    "inviteCalls" INTEGER NOT NULL DEFAULT 0,
    "messageCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LiApiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiApiUsage_accountId_day_key" ON "LiApiUsage"("accountId", "day");
CREATE INDEX "LiApiUsage_accountId_idx" ON "LiApiUsage"("accountId");
