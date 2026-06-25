-- ACL: address-scoped access (owner→team→user). See docs/acl.md.
-- Additive over 0003. Mirrors packages/core/src/server/schema.ts (drift-checked).

ALTER TABLE messages ADD COLUMN address_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_address ON messages (address_id, received_at DESC);

CREATE TABLE IF NOT EXISTS addresses (
  id         TEXT PRIMARY KEY,
  address    TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role    TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS address_grants (
  address_id TEXT NOT NULL,
  user_id    TEXT,
  team_id    TEXT,
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (team_id IS NOT NULL)),
  UNIQUE (address_id, user_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON address_grants (user_id);
CREATE INDEX IF NOT EXISTS idx_grants_team ON address_grants (team_id);

-- Backfill: one addresses row per distinct receiving address, then stamp each
-- message's address_id. randomblob/strftime are SQLite/D1 built-ins.
INSERT OR IGNORE INTO addresses (id, address, created_at)
  SELECT 'adr_' || lower(hex(randomblob(12))), to_addr, (strftime('%s','now') * 1000)
  FROM (SELECT DISTINCT to_addr FROM messages WHERE to_addr <> '');

UPDATE messages
  SET address_id = (SELECT a.id FROM addresses a WHERE a.address = messages.to_addr)
  WHERE address_id IS NULL AND to_addr <> '';
