-- Allow a mailbox to accept self-signed / private-CA IMAP TLS certificates.
ALTER TABLE "EmailAccount"
  ADD COLUMN "imapAllowSelfSigned" BOOLEAN NOT NULL DEFAULT false;
