-- Client-portal templates need admin/sub-admin approval before they can be sent.
-- Existing templates default to APPROVED so every running sequence and campaign
-- keeps sending exactly as before.
CREATE TYPE "TemplateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "EmailTemplate" ADD COLUMN "status" "TemplateStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "EmailTemplate" ADD COLUMN "reviewNote" TEXT;
ALTER TYPE "ApprovalEntity" ADD VALUE 'TEMPLATE';
