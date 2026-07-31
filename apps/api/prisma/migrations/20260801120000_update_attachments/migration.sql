-- Attachments on Work/Meetings/Notification threads and their replies.
-- Private blobs; served only through the gated download route.
ALTER TABLE "UpdateThread" ADD COLUMN "attachmentData" BYTEA;
ALTER TABLE "UpdateThread" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "UpdateThread" ADD COLUMN "attachmentMime" TEXT;

ALTER TABLE "UpdateReply" ADD COLUMN "attachmentData" BYTEA;
ALTER TABLE "UpdateReply" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "UpdateReply" ADD COLUMN "attachmentMime" TEXT;
