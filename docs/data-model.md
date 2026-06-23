# MailKite Mail — Data Model

> **One-liner:** MailKite Mail keeps its **own** portable SQLite/D1 store, populated exclusively by the inbound webhook — one schema, two runtimes (D1 on Workers, SQLite on Node), never touching MailKite's internal database.

This doc defines the persistence layer: the storage decision, the schema (every `CREATE TABLE`), the one storage-adapter interface that makes the schema run on both targets, the migration approach, and the exact webhook-field → local-column mapping. Field names are aligned to the `email.received` webhook payload so ingest is a near-mechanical copy.

See [`stack.md`](stack.md) for the dual-target Hono/Vite runtime, and the webhook-receiver doc for signature verification and the ingest pipeline. This doc **supersedes** [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) §4, which proposed reusing MailKite's D1 directly plus an IndexedDB client cache — the locked decision below is an **own, portable, server-side store** instead.

---

## 1. The decision

> **Decision (2026-06): MailKite Mail keeps its OWN store, fed exclusively by the inbound webhook. It never reads or writes MailKite's internal D1. One portable SQL schema runs on Cloudflare D1 (hosted) and Node SQLite (self-host: `better-sqlite3` or `libsql`). A self-hoster needs only a MailKite API key + a webhook secret (`whsec_*`).**

The boundary is narrow and one-directional:

- **In:** the `email.received` webhook is the *only* source of stored mail. Verify HMAC, then write to our store (§7).
- **Out:** `POST /v1/send` is the *only* outbound path. No SMTP, no IMAP, no POP.
- **Never:** direct access to MailKite's `messages`/`attachments` tables (`../../api/migrations/0001_init.sql`, `../../api/migrations/0003_attachments.sql`).

---

## 2. Why an own store (and not "share MailKite's D1")

The whole OSS story is portability: clone the repo, set two secrets, run anywhere. Coupling to MailKite's internal database would break that — and several pieces of inbox state simply do not exist upstream.

| Concern | Own store (chosen) | Share MailKite's D1 (rejected) |
|---|---|---|
| Self-host coupling | Needs only API key + `whsec_*` | Needs DB credentials + network access to MailKite's D1 |
| Portability | One schema runs on D1 **and** Node SQLite | Tied to Cloudflare D1 and MailKite's bindings |
| Inbox-only state (read/unread, stars, labels, drafts, identities, contacts, threads) | First-class columns/tables | Not modeled upstream — would need a second store anyway |
| Attachment permanence | We re-store bytes on ingest (see below) | Bytes vanish after 7 days; URLs are signed/expiring |
| Schema ownership | We migrate freely | We'd be coupled to upstream migration churn |
| Cost | Duplicated storage (accepted — per-seat mail volume is small) | None, but at the cost of every row above |

**Attachment retention is the clinching reason.** Webhook attachment URLs are signed and valid for **7 days**, and the R2 bytes behind them are **deleted after 7 days** by a bucket lifecycle rule (see the comment near the lifecycle config in `../../api/src/index.ts`). The signed URL is therefore **not** durable storage. To keep attachments past 7 days the webmail must download the bytes on ingest into its **own** blob store — which is why the schema has both an `attachments` index table and an `attachment_blobs` byte table (§4).

A second gotcha that forces our own modeling: MailKite's stored `to_addr` is a **single** TEXT column (one recipient), but the webhook delivers `to` as an **array**. The webhook is the source of truth, so we keep the full recipient list (`to_json`).

---

## 3. Portable-SQL ground rules (the D1 ∩ Node-SQLite intersection)

D1 and `better-sqlite3`/`libsql` are all SQLite, but D1 is the strictest. Write DDL to the **intersection** so one set of `.sql` files runs on both. These rules also match the existing platform schema, so the two stores feel familiar.

| Concern | Rule | Why |
|---|---|---|
| Types | Only `TEXT`, `INTEGER`, `REAL`, `BLOB`. No `BOOLEAN`/`DATETIME`/`VARCHAR(n)`. | SQLite type affinity; D1 ignores sizes. |
| Booleans | `INTEGER NOT NULL DEFAULT 0` (0/1). | Portable; matches platform. |
| Timestamps | `INTEGER` unix **milliseconds** (`Date.now()`). | No TZ/`DATETIME` divergence; matches platform `received_at`. |
| IDs | App-generated `TEXT` PK (`msg_*`, `thr_*`, …). No `AUTOINCREMENT`. | No sequence semantics to vary; mirrors platform's `id('msg')`. |
| JSON | Store as `TEXT` (stringified), parse in app. Don't index `json_extract`. | Keep the query layer dumb and portable. |
| Blobs | Pluggable blob store; inline `BLOB` only as the self-host default. | D1 row/db size limits; R2 is the CF-native target (§5). |
| Search | v1: `LIKE` on a `search_text` column. FTS5 is opt-in later. | Portable baseline; FTS5 doubles migration surface. |
| Foreign keys | Declare `REFERENCES` for documentation; **don't** rely on cascade. Delete explicitly in app. | D1 FK enforcement is off by default — behavior parity. |
| Upsert | `INSERT … ON CONFLICT(…) DO UPDATE/NOTHING`. | Supported on both; powers idempotent ingest (§7). |
| Concurrency (Node) | `PRAGMA journal_mode=WAL` at boot. | Node-init only, never in schema; D1 self-manages. |

---

## 4. Schema

Naming: `snake_case`, `*_at` = unix-ms `INTEGER`, booleans = `INTEGER` 0/1, all PKs app-generated `TEXT`. Indexes are listed under each table.

### 4.1 `accounts` — the logged-in mailbox owner

```sql
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,           -- acc_*
  email         TEXT NOT NULL UNIQUE,       -- login identity
  display_name  TEXT,
  password_hash TEXT,                       -- self-host local auth; NULL when SSO
  created_at    INTEGER NOT NULL
);
```

### 4.2 `identities` — from-addresses an account can send as

Multi-identity. Also the **inbound routing key**: the webhook delivers `to:[{address}]`; we match `address` → identity → account.

```sql
CREATE TABLE identities (
  id                      TEXT PRIMARY KEY,           -- idn_*
  account_id              TEXT NOT NULL REFERENCES accounts(id),
  address                 TEXT NOT NULL,              -- must be a MailKite-owned/verified send domain
  display_name            TEXT,                       -- "Gabe <me@acme.com>"
  signature_html          TEXT,
  signature_text          TEXT,
  is_default              INTEGER NOT NULL DEFAULT 0,
  mailkite_webhook_secret TEXT,                       -- whsec_* this identity's inbound is signed with
  created_at              INTEGER NOT NULL
);
CREATE INDEX idx_identities_account ON identities (account_id);
CREATE UNIQUE INDEX idx_identities_address ON identities (account_id, address);
```

### 4.3 `threads` — conversation grouping (webmail-owned)

This is **not** a 1:1 copy of MailKite's `threadId`. See §6 for why MailKite's `threadId` is single-hop and the grouping algorithm we run instead.

```sql
CREATE TABLE threads (
  id              TEXT PRIMARY KEY,                 -- thr_*
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  subject         TEXT,                             -- normalized (Re:/Fwd: stripped)
  root_message_id TEXT,                             -- RFC Message-ID of the conversation root
  last_message_at INTEGER NOT NULL,                 -- list sort key
  message_count   INTEGER NOT NULL DEFAULT 0,
  unread_count    INTEGER NOT NULL DEFAULT 0,
  is_starred      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_threads_account_last ON threads (account_id, last_message_at DESC);  -- inbox list
CREATE INDEX idx_threads_root         ON threads (account_id, root_message_id);       -- grouping lookup
```

### 4.4 `messages` — one row per received/sent email

The core table. Maps near-directly from the webhook payload and from `/v1/send` responses. Field-by-field mapping is in §8.

```sql
CREATE TABLE messages (
  id                TEXT PRIMARY KEY,                 -- own id, msg_*
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  thread_id         TEXT REFERENCES threads(id),
  mailkite_id       TEXT,                             -- webhook payload .id (provider message id)
  rfc_message_id    TEXT,                             -- RFC5322 Message-ID header (threading key)
  in_reply_to       TEXT,                             -- RFC In-Reply-To (seeded from webhook threadId)
  references_json   TEXT,                             -- RFC References chain, JSON array
  direction         TEXT NOT NULL,                    -- 'inbound' | 'outbound' (mirror platform)
  from_addr         TEXT NOT NULL,
  from_name         TEXT,
  to_json           TEXT NOT NULL,                    -- JSON array of {address,name} (to[] is an array!)
  cc_json           TEXT,                             -- JSON array
  bcc_json          TEXT,                             -- outbound only
  subject           TEXT,
  text_body         TEXT,
  html_body         TEXT,
  snippet           TEXT,                             -- first ~140 chars of text, for list preview
  search_text       TEXT,                             -- lowercased subject+from+text, for LIKE search
  headers_json      TEXT,                             -- full headers (mirror platform headers_json)
  auth_spf          TEXT,
  auth_dkim         TEXT,
  auth_dmarc        TEXT,
  auth_spam         TEXT,                             -- maps webhook auth.{spf,dkim,dmarc,spam}
  is_read           INTEGER NOT NULL DEFAULT 0,       -- webmail-only state
  is_starred        INTEGER NOT NULL DEFAULT 0,
  is_draft          INTEGER NOT NULL DEFAULT 0,
  folder            TEXT NOT NULL DEFAULT 'inbox',    -- inbox|sent|drafts|archive|trash|spam
  send_status       TEXT,                             -- outbound: NULL|queued|sent|failed (from /v1/send)
  received_at       INTEGER NOT NULL,                 -- ms; mirror platform received_at
  ingest_dedupe_key TEXT,                             -- see §7
  created_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_messages_dedupe       ON messages (account_id, ingest_dedupe_key);  -- idempotent ingest
CREATE INDEX        idx_messages_account_recv ON messages (account_id, received_at DESC);   -- mirror (user_id, received_at)
CREATE INDEX        idx_messages_thread       ON messages (thread_id, received_at);
CREATE INDEX        idx_messages_folder       ON messages (account_id, folder, received_at DESC);
CREATE INDEX        idx_messages_rfcid        ON messages (account_id, rfc_message_id);      -- threading resolution
```

> **Drafts: reuse this table.** A draft is just `is_draft=1, folder='drafts', send_status=NULL`. Compose/edit/send is then one code path: on send, call `POST /v1/send`, flip `is_draft=0`, set `direction='outbound'`, and write `send_status` + `mailkite_id` from the `{id,status}` response. (A separate `drafts` table is possible but redundant — we lean reuse.)

### 4.5 `attachments` — index rows (mirror platform + blob link)

```sql
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,                  -- att_* (or "<message_id>:<idx>" to mirror platform)
  message_id   TEXT NOT NULL REFERENCES messages(id),
  idx          INTEGER NOT NULL,                  -- position; mirror platform
  filename     TEXT,
  content_type TEXT,
  size         INTEGER NOT NULL DEFAULT 0,
  disposition  TEXT,                              -- attachment|inline (mirror platform)
  content_id   TEXT,                              -- cid for inline (mirror platform)
  blob_id      TEXT REFERENCES attachment_blobs(id),  -- NULL until bytes fetched/stored
  source_url   TEXT,                              -- the webhook signed URL — EXPIRES in 7d (§2)
  fetched_at   INTEGER,                           -- when we pulled bytes into our store; NULL = not yet
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_attachments_message ON attachments (message_id, idx);  -- mirror platform
```

### 4.6 `attachment_blobs` — the actual bytes (pluggable; see §5)

```sql
CREATE TABLE attachment_blobs (
  id           TEXT PRIMARY KEY,                  -- blob_*
  sha256       TEXT,                              -- content hash → dedupe identical attachments
  size         INTEGER NOT NULL,
  content_type TEXT,
  storage      TEXT NOT NULL,                     -- 'db' | 'r2' | 'fs'  (which backend holds bytes)
  storage_key  TEXT,                              -- r2 key / fs path; NULL when storage='db'
  bytes        BLOB,                              -- populated ONLY when storage='db' (dev/small-file)
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_blobs_sha ON attachment_blobs (sha256);  -- content-addressed dedupe
```

> **Trade-off:** on Cloudflare, keep bytes **out** of the primary DB — use R2 (`storage='r2'`). Inline `BLOB` (`storage='db'`) is the zero-config self-host default for small files. Either way the **index** schema is identical, so the table is portable; only the `BlobStore` impl differs (§5).

### 4.7 `labels` and `message_labels` — user labels beyond system folders

```sql
CREATE TABLE labels (
  id         TEXT PRIMARY KEY,                    -- lbl_*
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name       TEXT NOT NULL,
  color      TEXT,                                -- hex; ties to design tokens
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_labels_name ON labels (account_id, name);

CREATE TABLE message_labels (
  message_id TEXT NOT NULL REFERENCES messages(id),
  label_id   TEXT NOT NULL REFERENCES labels(id),
  PRIMARY KEY (message_id, label_id)
);
CREATE INDEX idx_message_labels_label ON message_labels (label_id);  -- "show all in label X"
```

A join table (not a JSON column) so label views index well.

### 4.8 `contacts` — derived address book

Auto-populated from senders/recipients on ingest and send for compose autocomplete.

```sql
CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,                  -- con_*
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  address      TEXT NOT NULL,
  display_name TEXT,
  last_seen_at INTEGER,                           -- autocomplete ranking
  seen_count   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_contacts_addr     ON contacts (account_id, address);
CREATE INDEX        idx_contacts_lastseen ON contacts (account_id, last_seen_at DESC);
```

On ingest/send, upsert each from/to/cc address:
`INSERT … ON CONFLICT(account_id, address) DO UPDATE SET seen_count = seen_count + 1, last_seen_at = ?`.

### 4.9 `ingest_log` — idempotency / dedupe ledger

`messages.ingest_dedupe_key` already enforces dedupe via its `UNIQUE` index (§7). This thin log records each accepted/skipped webhook delivery for traceability and replay debugging.

```sql
CREATE TABLE ingest_log (
  id          TEXT PRIMARY KEY,                   -- ing_*
  account_id  TEXT REFERENCES accounts(id),
  mailkite_id TEXT,                               -- webhook payload .id
  dedupe_key  TEXT NOT NULL,                      -- same key written to messages.ingest_dedupe_key
  message_id  TEXT REFERENCES messages(id),       -- resolved message (existing on dedupe hit)
  outcome     TEXT NOT NULL,                      -- 'ingested' | 'deduped' | 'rejected'
  sig_t       INTEGER,                            -- t from x-mailkite-signature (for stale-replay audit)
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_ingest_log_dedupe  ON ingest_log (account_id, dedupe_key);
CREATE INDEX idx_ingest_log_created ON ingest_log (account_id, created_at DESC);
```

### 4.10 `_migrations` — Node-side migration tracker

D1 uses wrangler's own `d1_migrations` table; Node uses this one, written by the tiny migration runner described in §6.

```sql
CREATE TABLE _migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

---

## 5. The storage-adapter interface (the portability seam)

This mirrors the platform's `interface Repo` + `makeRepo(env)` factory in `../../api/src/db/repo.ts`, but makes the SQL **executor** pluggable so the *same* repo runs on D1 and Node SQLite. Three layers.

### (A) `SqlDriver` — the only thing that differs per target

```ts
interface SqlDriver {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  batch(stmts: { sql: string; params?: unknown[] }[]): Promise<void>;  // D1 .batch / Node tx
}

// Two impls:
//   d1Driver(env.DB)                          → D1: db.prepare(sql).bind(...).all()/.first()/.run()
//   sqliteDriver(betterSqliteOrLibsqlClient)  → Node: db.prepare(sql).all(...)/.get(...)/.run(...)
```

> **The one real impedance mismatch:** D1 is async; `better-sqlite3` is **sync**. Wrap the sync calls in `Promise.resolve(...)` inside `sqliteDriver` so the interface is uniformly **async** for both. (`libsql` is already async.) Callers never know which backend they're on.

### (B) `BlobStore` — decoupled from SQL (CF→R2, Node→fs/db)

```ts
interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: ReadableStream | Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

// r2BlobStore(env.MAIL_BUCKET)  |  fsBlobStore('./data/blobs')  |  dbBlobStore(driver)  // inline BLOB
```

### (C) `MailRepo` — typed domain methods, built once over `SqlDriver`

```ts
interface MailRepo {
  // ingest (idempotent — §7)
  ingestWebhookMessage(p: WebhookPayload, accountId: string): Promise<{ messageId: string; deduped: boolean }>;

  // reads
  listThreads(accountId: string, folder: string, opts: { limit: number; cursor?: string }): Promise<ThreadRow[]>;
  getThread(accountId: string, threadId: string): Promise<{ thread: ThreadRow; messages: MessageRow[]; attachments: AttachmentRow[] }>;
  listMessages(accountId: string, opts: { folder?: string; limit: number; cursor?: string }): Promise<MessageRow[]>;
  getMessage(id: string): Promise<MessageRow | null>;

  // state
  setRead(messageIds: string[], isRead: boolean): Promise<void>;
  setStarred(messageIds: string[], isStarred: boolean): Promise<void>;
  move(messageIds: string[], folder: string): Promise<void>;
  addLabel(messageId: string, labelId: string): Promise<void>;
  removeLabel(messageId: string, labelId: string): Promise<void>;

  // compose / contacts
  saveDraft(d: DraftInput): Promise<string>;
  searchContacts(accountId: string, q: string): Promise<ContactRow[]>;
}

function makeMailRepo(driver: SqlDriver, blobs: BlobStore): MailRepo;
```

**Wiring per target** — the only place the two runtimes diverge:

```ts
// Cloudflare Worker
const repo = makeMailRepo(d1Driver(env.DB), r2BlobStore(env.MAIL_BUCKET));

// Node (@hono/node-server)
const repo = makeMailRepo(sqliteDriver(db), fsBlobStore('./data/blobs'));
```

The Hono routes (webhook receiver + SPA-data endpoints) depend only on `MailRepo`, so the same `src/index.ts` boots on both targets. **That is the dual-target OSS install story** ([`stack.md`](stack.md)).

---

## 6. Migrations

One migration source, two runners — exactly the platform convention (`../../api/migrations/`).

- **Convention:** ordered files `migrations/0001_init.sql`, `0002_*.sql`, … in the **intersection dialect** (§3). No wrangler-specific or Node-specific SQL.
- **Cloudflare:** `wrangler d1 migrations apply <db> --remote`. Wrangler maintains its own `d1_migrations` table.
- **Node:** a ~30-line runner ships in the repo — reads `migrations/*.sql` in order, skips any name already recorded in `_migrations`, executes the rest in a transaction, then records `name` + `applied_at`. (Boot also runs `PRAGMA journal_mode=WAL`, §3.)

Because the DDL stays in the intersection, the **same files** drive both runners.

### Threading note (why §4.3 exists)

MailKite's webhook `threadId` is **single-hop**: `processInbound` sets it to `parsed.inReplyTo ?? parsed.messageId ?? null` (see `../../api/src/index.ts`). It is essentially the RFC Message-ID of the In-Reply-To target, or the message's own Message-ID — **not** a stable conversation root across a long thread. So the webmail does its **own** grouping:

1. **References / In-Reply-To chain** → the thread of any already-stored message it points at.
2. else **normalized-subject + participant** match within a recency window.
3. else **new thread**.

Gotcha: the live webhook payload (`buildWebhookPayload`) carries only `threadId`, **not** raw RFC headers. To thread accurately, either thread off `threadId` + normalized subject (zero extra calls), or **enrich** via `GET /api/messages/:id`, which returns the full `message` including `headers_json` (and `deliveries`, `attachments`). Pick per deployment; document the choice. We seed `messages.in_reply_to` from the webhook `threadId` and resolve from there.

---

## 7. Idempotent ingest (dedupe)

Webhooks get re-delivered — MailKite has a redeliver path that rebuilds and re-POSTs the **exact** payload (same `id`) via `buildWebhookPayload` (`../../api/src/index.ts`). Ingest **must** be idempotent.

1. **Verify the HMAC first.** Header `x-mailkite-signature: t=<unix_ms>,v1=<hex>`; formula `HMAC-SHA256(secret, "<t>." + rawBody)`, lowercase hex, constant-time compare, default 5-min tolerance. Use `MailKite.verifyWebhook(signature, rawBody, secret, toleranceMs)` from `../../sdks/node/index.js`. Reject bad/stale signatures before touching the DB — signature is the first line of defense, dedupe the second.
2. **Compute `ingest_dedupe_key`** from the most stable identifier available, in order:
   1. webhook payload `.id` (MailKite message id — stable across redelivery; redeliver rebuilds from the stored msg with the same `id`);
   2. else RFC `Message-ID`;
   3. else `sha256(from + received-bucket + subject + first-N-bytes-of-body)`.
3. **Upsert:** `INSERT … ON CONFLICT(account_id, ingest_dedupe_key) DO NOTHING`. If `changes === 0` the message already exists → look it up and return `{ deduped: true }`. Portable on D1 + SQLite.
4. **Record** the outcome in `ingest_log` (§4.9).
5. **Attachment bytes** are deduped independently by `attachment_blobs.sha256` (§4.6), so re-ingest or identical attachments across messages never duplicate bytes.

---

## 8. Field mapping: webhook payload → local columns

The `email.received` payload (built by `buildWebhookPayload`, `../../api/src/index.ts`):

```json
{
  "id": "...",
  "type": "email.received",
  "from": { "address": "sender@example.com" },
  "to": [{ "address": "me@acme.com" }],
  "subject": "Hello",
  "text": "...",
  "html": "...",
  "threadId": "<msgid@host>",
  "auth": { "spf": "pass", "dkim": "pass", "dmarc": "pass", "spam": "ham" },
  "attachments": [{ "id": "<mid>:0", "filename": "a.pdf", "contentType": "application/pdf", "size": 1234, "url": "https://.../att/<mid>/0?exp=...&sig=..." }]
}
```

### `messages`

| Webhook field | `messages` column | Notes |
|---|---|---|
| `id` | `mailkite_id` | provider id; also drives the dedupe key (§7) |
| `from.address` | `from_addr` | |
| `to[]` | `to_json` | full array preserved (upstream stores only one) |
| `subject` | `subject` | also fed into `search_text`, normalized into `threads.subject` |
| `text` | `text_body` | first ~140 chars → `snippet`; lowercased → `search_text` |
| `html` | `html_body` | |
| `threadId` | `in_reply_to` | seed only; run thread resolution (§6) to set `thread_id` |
| `auth.spf` | `auth_spf` | |
| `auth.dkim` | `auth_dkim` | |
| `auth.dmarc` | `auth_dmarc` | |
| `auth.spam` | `auth_spam` | |
| Message-ID header¹ | `rfc_message_id` | threading key; from enrichment (§6) |
| (delivery time) | `received_at` | unix ms |
| `type` | — | gates ingest (`"email.received"`); not stored |

¹ Available only via `GET /api/messages/:id` enrichment, not in the live webhook payload.

### `attachments` (one row per `attachments[i]`)

| Webhook field | `attachments` column | Notes |
|---|---|---|
| `attachments[].id` | `id` | mirrors platform `"<message_id>:<idx>"` form |
| `attachments[].filename` | `filename` | |
| `attachments[].contentType` | `content_type` | |
| `attachments[].size` | `size` | |
| `attachments[].url` | `source_url` | **signed, expires in 7 days (§2)** — fetch bytes → `attachment_blobs`, set `blob_id`, `fetched_at` |
| (array index) | `idx` | position |

### `/v1/send` response → `messages` (outbound)

| Send field | `messages` column |
|---|---|
| request `from` | `from_addr` (+ `from_name`) |
| request `to`/`cc`/`bcc` | `to_json` / `cc_json` / `bcc_json` |
| request `subject`/`html`/`text` | `subject` / `html_body` / `text_body` |
| request `inReplyTo` | `in_reply_to` (MailKite auto-sets RFC In-Reply-To + References) |
| response `id` | `mailkite_id` |
| response `status` | `send_status` |
| (on success) | `direction='outbound'`, `is_draft=0`, `folder='sent'` |

---

## 9. Open trade-offs (decide per deployment)

| Trade-off | Baseline (v1) | Upgrade path |
|---|---|---|
| Search | `search_text` + `LIKE` (portable, simple) | FTS5 (works on both; doubles migration surface) — opt-in |
| Attachment bytes | inline `BLOB` (`storage='db'`, zero-config self-host) | R2 / fs for scale; same index schema |
| Drafts | reuse `messages` (`is_draft=1`) — one compose/send path | separate table (redundant) |
| Threading headers | thread off `threadId` + normalized subject (no extra calls) | enrich via `GET /api/messages/:id` for full `headers_json` |
| D1 sync/async | uniformly-async `SqlDriver` wraps sync `better-sqlite3` | — (resolved, not optional) |

---

## 10. See also

- [`00-overview.md`](00-overview.md) — what MailKite Mail is and the doc set.
- [`stack.md`](stack.md) — the dual-target Hono + Vite runtime.
- [`../../api/migrations/0001_init.sql`](../../api/migrations/0001_init.sql), [`../../api/migrations/0003_attachments.sql`](../../api/migrations/0003_attachments.sql) — platform tables we map from.
- [`../../api/src/db/repo.ts`](../../api/src/db/repo.ts) — the `Repo`/`makeRepo` pattern mirrored by `MailRepo`.
- [`../../api/src/index.ts`](../../api/src/index.ts) — `buildWebhookPayload`, `processInbound`, redeliver, attachment lifecycle.
- [`../../sdks/node/index.js`](../../sdks/node/index.js) — `MailKite.verifyWebhook`.
- [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) — superseded §4 (shared-D1 + IndexedDB).
