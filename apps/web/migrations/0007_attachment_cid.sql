-- Inline-image + downloadable-attachment support.
-- Carry the MIME Content-ID and the disposition (attachment|inline) on stored attachments so the
-- reader can map body `cid:` references to the inline part and list true downloads separately.
-- Nullable; pre-existing rows backfill to NULL (they render as before). Order matches schema.ts.
ALTER TABLE attachments ADD COLUMN content_id TEXT;
ALTER TABLE attachments ADD COLUMN disposition TEXT;
