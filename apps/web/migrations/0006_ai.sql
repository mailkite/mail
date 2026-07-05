-- Assistant persistence (phase I5).
--   ai_cache: content-derived AI output (summary, smart replies) keyed by message, so opening a
--             message twice doesn't recompute (or re-bill). ACL is enforced at the route by
--             loading the message through the Actor before reading the cache.
--   todos:    per-user action items for a message. AI seeds them once; the user then owns them
--             (check off, edit, add, delete). Persisted long-term.
CREATE TABLE IF NOT EXISTS ai_cache (
  message_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  content    TEXT NOT NULL,
  model      TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, kind)
);

CREATE TABLE IF NOT EXISTS todos (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_msg_user ON todos (message_id, user_id, position);
CREATE INDEX IF NOT EXISTS idx_todos_user ON todos (user_id);
