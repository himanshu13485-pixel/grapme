-- Feature-style pricing card: a plan can show a free-text feature list instead
-- of the credits/entitlements breakdown.
ALTER TABLE "Plan" ADD COLUMN "cardStyle" TEXT NOT NULL DEFAULT 'entitlements';
ALTER TABLE "Plan" ADD COLUMN "features" JSONB;
