-- Explicit encryption mode per connection (SMTP + IMAP): SSL | STARTTLS | NONE.
ALTER TABLE "EmailAccount" ADD COLUMN "smtpEncryption" TEXT NOT NULL DEFAULT 'SSL';
ALTER TABLE "EmailAccount" ADD COLUMN "imapEncryption" TEXT NOT NULL DEFAULT 'SSL';

-- Backfill SMTP mode from the legacy boolean + port (587/25 → STARTTLS, else SSL).
UPDATE "EmailAccount"
SET "smtpEncryption" = CASE
  WHEN "smtpSecure" = true THEN 'SSL'
  WHEN "smtpPort" IN (587, 25) THEN 'STARTTLS'
  ELSE 'SSL'
END;

-- Backfill IMAP mode from the port (143 → STARTTLS, else SSL).
UPDATE "EmailAccount"
SET "imapEncryption" = CASE WHEN "imapPort" = 143 THEN 'STARTTLS' ELSE 'SSL' END;
