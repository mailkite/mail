-- Team email: multi-user members + provisioned send-as addresses.
-- Additive over 0001. Mirrors packages/core/src/server/schema.ts; kept in sync
-- by apps/web/test/migration-drift.test.ts. See docs/teams.md.

-- Members gain identity/invite fields. OAuth (Google) users carry password_hash=''.
ALTER TABLE users ADD COLUMN name TEXT;
ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'password';
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN invited_by TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- Provisioned send-as addresses (team-wide, no ACL).
CREATE TABLE IF NOT EXISTS sender_accounts (
  id         TEXT PRIMARY KEY,
  address    TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
