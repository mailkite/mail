/**
 * The own-store schema. Written to be valid on both SQLite (Node) and D1
 * (Workers). Phase 1 covers the core four tables; labels/contacts/identities/
 * drafts (see docs/data-model.md) land in later phases.
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
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread   ON messages (thread_id);

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

-- Dedupe key so re-delivered webhooks are no-ops (idempotent ingest).
CREATE TABLE IF NOT EXISTS ingest_log (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);
`
