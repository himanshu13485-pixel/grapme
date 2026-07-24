-- LiSequenceStep.randomGroup: MESSAGE steps sharing the same non-null value are
-- random alternatives (exactly one is sent per lead). Idempotent for safe re-runs.
ALTER TABLE "LiSequenceStep" ADD COLUMN IF NOT EXISTS "randomGroup" INTEGER;
