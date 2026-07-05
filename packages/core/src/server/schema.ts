/**
 * The own-store schema. Valid on both SQLite (Node) and D1 (Workers).
 * (labels/contacts/identities/drafts beyond this grow per docs/data-model.md.)
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS threads (
  id               TEXT PRIMARY KEY,
  subject          TEXT,
  last_received_at INTEGER NOT NULL,
  message_count    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  direction   TEXT NOT NULL DEFAULT 'inbound',
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  subject     TEXT,
  text_body   TEXT,
  html_body   TEXT,
  spf         TEXT,
  dkim        TEXT,
  dmarc       TEXT,
  spam        TEXT,
  unread      INTEGER NOT NULL DEFAULT 1,
  starred     INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  address_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread   ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_folder   ON messages (archived, starred, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_address  ON messages (address_id, received_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL,
  idx          INTEGER NOT NULL,
  filename     TEXT,
  content_type TEXT,
  size         INTEGER,
  blob_key     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

CREATE TABLE IF NOT EXISTS labels (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  color TEXT
);
CREATE TABLE IF NOT EXISTS message_labels (
  message_id TEXT NOT NULL,
  label_id   TEXT NOT NULL,
  PRIMARY KEY (message_id, label_id)
);

-- Dedupe key so re-delivered webhooks are no-ops (idempotent ingest).
CREATE TABLE IF NOT EXISTS ingest_log (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

-- Team members. password_hash is '' for OAuth (Google) users. Column order
-- matches migration 0002's ALTER ADD COLUMNs so both build paths agree.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL,
  name          TEXT,
  provider      TEXT NOT NULL DEFAULT 'password',
  google_sub    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  invited_by    TEXT,
  avatar_url    TEXT,
  github_sub    TEXT
);

-- Operator-saved config (env-first; this is the DB fallback). Secrets included.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Provisioned send-as addresses (support@, hello@, per-person). Team-wide, no
-- per-user ACL — any member may send as any of these. See docs/teams.md.
CREATE TABLE IF NOT EXISTS sender_accounts (
  id         TEXT PRIMARY KEY,
  address    TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- One-time email verification codes (OTP) for signup. Short-lived, hashed.
CREATE TABLE IF NOT EXISTS email_codes (
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes (email);

-- ACL (see docs/acl.md): the resource is the mailbox address; access is a grant
-- (direct user→address or via a team). Admin (users.role='admin') sees all.
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
`
