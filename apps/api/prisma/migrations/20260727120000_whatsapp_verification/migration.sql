-- WhatsApp number verification (OTP).
-- Alerts are only ever sent to a number the user has proved is theirs.

ALTER TABLE "User" ADD COLUMN "whatsappVerifiedAt" TIMESTAMP(3);

CREATE TABLE "WhatsappVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappVerification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WhatsappVerification_userId_idx" ON "WhatsappVerification"("userId");

CREATE INDEX "WhatsappVerification_userId_expiresAt_idx" ON "WhatsappVerification"("userId", "expiresAt");

ALTER TABLE "WhatsappVerification" ADD CONSTRAINT "WhatsappVerification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
