-- Per-client toggle: charge 1 credit per LinkedIn lead-sourcing run (additive).
ALTER TABLE "Client" ADD COLUMN "linkedInCreditMetering" BOOLEAN NOT NULL DEFAULT false;
