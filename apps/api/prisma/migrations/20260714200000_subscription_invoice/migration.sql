-- Invoice number snapshot on each subscription period (for the renewal history).
ALTER TABLE "SubscriptionPeriod" ADD COLUMN "invoiceNo" TEXT;
