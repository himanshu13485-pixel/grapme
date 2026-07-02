-- Client-portal: how many profiles a client login may self-create (billable).
ALTER TABLE "User" ADD COLUMN "profileLimit" INTEGER NOT NULL DEFAULT 1;
