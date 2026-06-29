-- AlterTable: per-stage follow-up wait (business days after the previous stage)
ALTER TABLE "SequenceStep" ADD COLUMN "waitDays" INTEGER NOT NULL DEFAULT 10;
