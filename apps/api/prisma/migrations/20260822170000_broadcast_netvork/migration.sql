-- Broadcasts can pick Netvork the same way they pick Email, WhatsApp or
-- Telegram: a column of its own, defaulting off.
--
-- A column rather than letting the channel ride along with another: notifyMany
-- defaults an unnamed channel to whatever `whatsapp` is set to, so without
-- this a broadcast marked for WhatsApp would quietly have gone out on Netvork
-- too. Every channel a broadcast sends on is now one somebody ticked.
ALTER TABLE "Broadcast" ADD COLUMN "sendNetvork" BOOLEAN NOT NULL DEFAULT false;
