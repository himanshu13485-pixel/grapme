-- AlterTable: month-based sequence planning (which cohort-month a stage sends in)
ALTER TABLE "SequenceStep" ADD COLUMN "monthOffset" INTEGER NOT NULL DEFAULT 1;
