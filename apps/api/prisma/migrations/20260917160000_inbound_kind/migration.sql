-- Tell apart a real reply, an auto-responder (out-of-office) and a bounce, so an
-- out-of-office no longer stops a sequence and can still be seen in the inbox.
ALTER TABLE "EmailMessage" ADD COLUMN "inboundKind" TEXT;
