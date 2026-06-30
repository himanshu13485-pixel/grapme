-- Reconcile: mark enrollments REPLIED for any contact that already has a REPLY
-- event recorded (older replies were logged as events but never flipped the
-- enrollment status, so the cohort "Replied" count read 0).
UPDATE "Enrollment" e
SET "status" = 'REPLIED'
WHERE e."status" = 'ACTIVE'
  AND EXISTS (
    SELECT 1
    FROM "EmailMessage" m
    JOIN "EmailEvent" ev ON ev."messageId" = m."id" AND ev."eventType" = 'REPLY'
    WHERE m."contactId" = e."contactId"
  );
