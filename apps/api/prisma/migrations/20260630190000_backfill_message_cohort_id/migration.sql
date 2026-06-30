-- Backfill cohortId on outbound messages sent before the column existed, so the
-- cohort sending report reflects historical sends. Links each message to the
-- most recent cohort (for that contact + the mailbox's client) that had already
-- started when the message was created.
UPDATE "EmailMessage" m
SET "cohortId" = (
  SELECT e."cohortId"
  FROM "Enrollment" e
  JOIN "EmailAccount" a ON a."id" = m."emailAccountId"
  JOIN "Cohort" c ON c."id" = e."cohortId"
  WHERE e."contactId" = m."contactId"
    AND e."clientId" = a."clientId"
    AND c."startDate" <= m."createdAt"
  ORDER BY c."startDate" DESC
  LIMIT 1
)
WHERE m."cohortId" IS NULL
  AND m."direction" = 'OUTBOUND'
  AND m."contactId" IS NOT NULL
  AND m."emailAccountId" IS NOT NULL;
