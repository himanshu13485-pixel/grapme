-- Optional "Most popular" highlight flag per plan.
ALTER TABLE "Plan" ADD COLUMN "popular" BOOLEAN NOT NULL DEFAULT false;
