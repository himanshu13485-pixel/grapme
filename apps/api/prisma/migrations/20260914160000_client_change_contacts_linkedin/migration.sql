-- More client-portal actions held for approval: single contacts and lists,
-- LinkedIn inbox replies, LinkedIn campaign archive/delete, and connecting a
-- LinkedIn account. Additive enum values only; no existing data changes.
ALTER TYPE "ClientChangeKind" ADD VALUE 'CONTACT_CREATE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'CONTACT_UPDATE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'CONTACT_DELETE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'CONTACT_BULK_DELETE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LIST_CREATE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LIST_DELETE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LIST_MEMBERS_ADD';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LIST_MEMBERS_REMOVE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LI_REPLY';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LI_CAMPAIGN_ARCHIVE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LI_CAMPAIGN_DELETE';
ALTER TYPE "ClientChangeKind" ADD VALUE 'LI_ACCOUNT_CONNECT';
