-- GitHub sign-in: stable GitHub user id, mirroring google_sub. Appended last to
-- match SCHEMA_SQL's column order (both build paths must agree). OAuth users
-- carry password_hash=''.
ALTER TABLE users ADD COLUMN github_sub TEXT;
