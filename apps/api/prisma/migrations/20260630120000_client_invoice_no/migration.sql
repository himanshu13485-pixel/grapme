-- Add an optional invoice/account reference to a client (company).
ALTER TABLE "Client" ADD COLUMN "invoiceNo" TEXT;
