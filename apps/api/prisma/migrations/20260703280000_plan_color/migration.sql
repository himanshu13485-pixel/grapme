-- Membership plan theme color (drives the client portal look).
ALTER TABLE "Plan" ADD COLUMN "color" TEXT NOT NULL DEFAULT '#0f766e';

-- Seed sensible defaults: Growth tiers keep the current green; Enterprise premium.
UPDATE "Plan" SET "color" = '#0f766e' WHERE "name" IN ('Growth', 'Growth Plus');
UPDATE "Plan" SET "color" = '#7c3aed' WHERE "name" = 'Enterprise';
