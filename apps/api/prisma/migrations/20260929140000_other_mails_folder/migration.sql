-- "Other Mails": a manual folder in Inbox & Sent. Nothing is filed there
-- automatically, so every existing message stays in the Inbox.
ALTER TABLE "EmailMessage" ADD COLUMN "otherFolder" BOOLEAN NOT NULL DEFAULT false;
