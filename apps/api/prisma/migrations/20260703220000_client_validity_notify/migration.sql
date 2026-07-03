-- Tracks the last plan-expiry reminder milestone emailed (0=none .. 4=expired).
ALTER TABLE "Client" ADD COLUMN "validityNotifyStage" INTEGER NOT NULL DEFAULT 0;
