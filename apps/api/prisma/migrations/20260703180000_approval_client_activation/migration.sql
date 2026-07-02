-- Fallback: a self-registered client who can't confirm their email is surfaced
-- as an admin approval; approving it activates the login.
ALTER TYPE "ApprovalEntity" ADD VALUE IF NOT EXISTS 'CLIENT_ACTIVATION';
