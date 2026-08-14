-- Per-message read receipts ("seen by") for Internal Work and Updates.

-- Internal Work: monotonic last-seen (readAt stays the unread marker).
ALTER TABLE "InternalNoteRecipient" ADD COLUMN "seenAt" TIMESTAMP(3);

-- Updates: per-user last-seen rows for a thread.
CREATE TABLE "UpdateThreadRead" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "userRole" "Role" NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpdateThreadRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UpdateThreadRead_threadId_userId_key" ON "UpdateThreadRead"("threadId", "userId");
CREATE INDEX "UpdateThreadRead_threadId_idx" ON "UpdateThreadRead"("threadId");

ALTER TABLE "UpdateThreadRead" ADD CONSTRAINT "UpdateThreadRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "UpdateThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
