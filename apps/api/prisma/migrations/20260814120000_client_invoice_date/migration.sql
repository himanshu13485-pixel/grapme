-- Invoice date on the client (for filtering / reporting).
ALTER TABLE "Client" ADD COLUMN "invoiceDate" TIMESTAMP(3);
