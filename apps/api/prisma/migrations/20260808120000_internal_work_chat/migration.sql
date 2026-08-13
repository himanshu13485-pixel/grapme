-- Internal Work: add salesperson audience + a multi-way chat thread.
ALTER TYPE "InternalNoteAudience" ADD VALUE IF NOT EXISTS 'ALL_STAFF_SALES';

CREATE TABLE "InternalNoteMessage" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authorName" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalNoteMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InternalNoteMessage_noteId_idx" ON "InternalNoteMessage"("noteId");
ALTER TABLE "InternalNoteMessage" ADD CONSTRAINT "InternalNoteMessage_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "InternalNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
