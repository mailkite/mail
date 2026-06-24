-- Email verification codes (OTP) for email+password signup. Short-lived, hashed,
-- single-use. Mirrors packages/core/src/server/schema.ts (drift-checked). See docs/teams.md.

CREATE TABLE IF NOT EXISTS email_codes (
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes (email);
