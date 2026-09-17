-- Bounce auto-disable threshold, tunable per tenant instead of hard-coded at 7%.
ALTER TABLE "Tenant" ADD COLUMN "bounceMaxRatePct" INTEGER NOT NULL DEFAULT 7;
