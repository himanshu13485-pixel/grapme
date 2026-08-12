-- Per-client hide: drop a default setup step from a single client (sticks across re-syncs).
ALTER TABLE "ClientSetupStep" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;
