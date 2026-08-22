-- Netvork as a third notification channel.
--
-- Unlike WhatsApp and Telegram it is our own app, so a user is an account on it
-- rather than a number on someone else's network. That is why it gets its own
-- address column instead of sharing contactMobile: an App ID is not a phone
-- number, and someone may well want alerts on Netvork and nowhere else.
ALTER TABLE "User" ADD COLUMN "netvorkAppId" TEXT;
ALTER TABLE "User" ADD COLUMN "notifyNetvork" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "netvorkVerifiedAt" TIMESTAMP(3);

-- ChannelVerification."phone" now holds whichever address the code went to,
-- which on Netvork is an App ID. The column keeps its name — it predates there
-- being anything but numbers — and the model maps `address` onto it.
