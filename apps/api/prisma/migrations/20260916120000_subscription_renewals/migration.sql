-- Subscription renewals: invoice history per subscription window + a renewal counter.
-- Additive only: nullable columns and a zero default, so existing clients are unchanged.
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "invoiceDate" TIMESTAMP(3);
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "recordedById" TEXT;
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "recordedByName" TEXT;
ALTER TABLE "Client" ADD COLUMN "renewalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Client" ADD COLUMN "lastRenewedAt" TIMESTAMP(3);
