-- Human-readable reason a mailbox is in its current state (e.g. auto-disabled by the bounce circuit breaker).
ALTER TABLE "EmailAccount" ADD COLUMN "statusReason" TEXT;
