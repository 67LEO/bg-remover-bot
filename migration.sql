-- Migration for new admin features.
-- All idempotent (safe to run multiple times).

-- Support threading: track when user added a new message to an open ticket
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS user_replied BOOLEAN DEFAULT FALSE;

-- Ban list: block abusive users from using the bot
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
