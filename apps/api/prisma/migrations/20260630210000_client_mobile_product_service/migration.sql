-- Client record details: mobile (with country code), product/category, service type.
ALTER TABLE "Client" ADD COLUMN "mobile" TEXT;
ALTER TABLE "Client" ADD COLUMN "productCategory" TEXT;
ALTER TABLE "Client" ADD COLUMN "serviceType" TEXT;
