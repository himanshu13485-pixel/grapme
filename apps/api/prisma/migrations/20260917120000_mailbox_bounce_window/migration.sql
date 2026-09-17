-- Bounce circuit breaker: judge only sends made since the mailbox was last enabled.
-- Without this, re-enabling an auto-disabled mailbox re-ran the same history and the
-- breaker disabled it again within the hour.
ALTER TABLE "EmailAccount" ADD COLUMN "bounceWindowFrom" TIMESTAMP(3);
