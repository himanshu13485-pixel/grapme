-- Telegram alongside WhatsApp: a second messaging channel, with its own
-- per-user opt-in and its own proof that the number reaches that person.
-- Verifying a number on one network says nothing about the other, so the
-- consent and the proof are tracked separately rather than shared.
ALTER TABLE "User" ADD COLUMN "notifyTelegram" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "telegramVerifiedAt" TIMESTAMP(3);

-- Broadcasts can pick the new channel the same way they pick email.
ALTER TABLE "Broadcast" ADD COLUMN "sendTelegram" BOOLEAN NOT NULL DEFAULT false;

-- The verification codes are no longer WhatsApp's alone. Renamed rather than
-- rebuilt: rows live ten minutes, but a rename keeps any in flight working.
ALTER TABLE "WhatsappVerification" RENAME TO "ChannelVerification";
ALTER INDEX "WhatsappVerification_pkey" RENAME TO "ChannelVerification_pkey";
ALTER INDEX "WhatsappVerification_userId_idx" RENAME TO "ChannelVerification_userId_idx";
ALTER INDEX "WhatsappVerification_userId_expiresAt_idx" RENAME TO "ChannelVerification_userId_expiresAt_idx";
ALTER TABLE "ChannelVerification" RENAME CONSTRAINT "WhatsappVerification_userId_fkey" TO "ChannelVerification_userId_fkey";

-- Existing codes were all WhatsApp ones, which is what the default says.
ALTER TABLE "ChannelVerification" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
CREATE INDEX "ChannelVerification_userId_channel_idx" ON "ChannelVerification"("userId", "channel");
