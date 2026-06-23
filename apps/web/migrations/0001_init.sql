-- MailKite Mail — initial own-store schema for D1 (Workers target).
-- Mirrors packages/core/src/server/schema.ts (SCHEMA_SQL); the Node target
-- applies that at runtime via MailRepo.migrate(). Kept in sync by
-- apps/web/test/migration-drift.test.ts.

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
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread   ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_folder   ON messages (archived, starred, received_at DESC);

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

-- Roles + admin-gated dashboard.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL
);

-- Operator-saved config (env-first; this is the DB fallback). Secrets included.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
