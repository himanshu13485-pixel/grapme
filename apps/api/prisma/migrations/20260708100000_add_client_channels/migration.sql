-- Client channel subscriptions (additive: existing rows keep Email, no LinkedIn).
ALTER TABLE "Client" ADD COLUMN "emailEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Client" ADD COLUMN "linkedInEnabled" BOOLEAN NOT NULL DEFAULT false;
