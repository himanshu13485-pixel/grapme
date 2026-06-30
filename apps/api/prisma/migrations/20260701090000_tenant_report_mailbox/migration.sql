-- Explicit mailbox client reports are sent from (null = auto-resolve).
ALTER TABLE "Tenant" ADD COLUMN "reportMailboxId" TEXT;
