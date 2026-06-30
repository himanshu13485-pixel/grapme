-- Track when an inbound reply was marked read (null = unread) for the Inbox badge.
ALTER TABLE "EmailMessage" ADD COLUMN "readAt" TIMESTAMP(3);
