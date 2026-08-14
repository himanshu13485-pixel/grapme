-- Global toggle for the daily setup-step reminders (email/WhatsApp to owners).
ALTER TABLE "Tenant" ADD COLUMN "setupRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;
