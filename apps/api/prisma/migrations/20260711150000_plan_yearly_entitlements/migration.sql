-- Optional per-plan YEARLY entitlement overrides (base columns remain the monthly set).
ALTER TABLE "Plan" ADD COLUMN "yearlyEntitlements" JSONB;
