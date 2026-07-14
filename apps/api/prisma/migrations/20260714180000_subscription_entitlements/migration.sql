-- Snapshot of a plan's entitlements at activation, for the renewal history detail.
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "entitlements" JSONB;
