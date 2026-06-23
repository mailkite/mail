# Architecture — runtime shape & data flow

> **One-liner:** MailKite Mail is a Hono app that **receives mail only via MailKite's signed
> webhook**, normalizes it into its **own store** (SQLite on Node / D1 on Workers), serves a
> React/Vite SPA that reads that store over JWT-authed `/api/*` endpoints, and **sends replies
> exclusively through MailKite's `/v1/send`**. Two credentials, two trust boundaries, one
> portable OSS install.

MailKite Mail never touches MailKite's internal database. From MailKite a self-hoster needs exactly
**two secrets**: a **MailKite API key** (`mk_live_*`, for sending) and a per-account **webhook
secret** (`whsec_*`, for verifying inbound). The only other secret is a **JWT signing secret** the
operator generates locally (`SESSION_SECRET`, for SPA sessions — see [`install.md`](install.md) §4).
That two-secret coupling to MailKite is the whole point of the open-source story — see
[`stack.md`](stack.md) for the dual Node/Workers target and [`data-model.md`](data-model.md) for the
table shapes referenced throughout this doc.

---

## 1. End-to-end data flow

There are two distinct credentials guarding two distinct boundaries:

| Boundary | Direction | Credential | Verifies / authorizes |
|---|---|---|---|
| `POST /webhook` | inbound from MailKite | webhook secret `whsec_*` | HMAC of the raw body (is this really MailKite?) |
| `POST https://api.mailkite.dev/v1/send` | outbound to MailKite | API key `mk_live_*` | server-to-server auth (may I send as this domain?) |
| `/api/*` | SPA ↔ Hono | own JWT (`Bearer`) | this user's session (scopes the store) |

```
                          MailKite platform
                                 │
        (1) signed webhook POST  │  email.received
            x-mailkite-signature │  t=<ms>,v1=<hex>
                                 ▼
   ┌─────────────────────────────────────────────────────────┐
   │  MailKite Mail  (Hono — one app, Node OR Workers)         │
   │                                                          │
   │  POST /webhook ─► verify HMAC (raw bytes, const-time,    │
   │                   ±5min window) ─► dedupe by payload.id  │
   │                   ─► normalize payload ─► UPSERT          │
   │                                       │                  │
   │                                       ▼                  │
   │                              ┌──────────────────┐        │
   │                              │   OWN store       │        │
   │                              │  SQLite | D1      │        │
   │                              └──────────────────┘        │
   │                                       ▲                  │
   │  /api/messages, /api/threads, ────────┘                  │
   │  /api/messages/:id  (JWT, reads OWN store)               │
   │                                                          │
   │  POST /api/send (JWT) ──► server-side fetch ─────────────┼──► (2) POST /v1/send
   │                          (API key mk_live_*)             │       (the ONLY send path)
   │                                                          │
   │  serves built Vite SPA (Workers assets / node static)    │
   └─────────────────────────────────────────────────────────┘
                                 ▲
                                 │  fetch JSON, Authorization: Bearer <jwt>
                                 ▼
                          React/Vite SPA  (browser)
```

The receiver (`POST /webhook`) is **HMAC-verified and never JWT-authed**. The read/reply routes
(`/api/*`) are **JWT-authed and never HMAC-verified**. These two route groups stay strictly
separate; neither accepts the other's data.

---

## 2. The webhook receiver — `POST /webhook`

This is the only way mail enters MailKite Mail. No IMAP, no POP, no SMTP-receive.

### 2.1 Signature verification

The request carries a signature header in MailKite's outbound form:

```
x-mailkite-signature: t=<unix_ms>,v1=<hex_hmac_sha256>
```

with

```
v1 = HMAC-SHA256(webhook_secret, "<t>." + rawBody)     // lowercase hex
```

This is exactly the scheme MailKite signs with — see `deliverWebhook` in
`../../api/src/index.ts` and the reference doc [`webhook-signatures.md`](../../docs/architecture/webhook-signatures.md).

Three rules, each a real foot-gun:

1. **Verify the RAW bytes.** Read `await c.req.arrayBuffer()` (or `text()`) *before*
   `c.req.json()`, and compute the MAC over those exact bytes. Re-serializing a parsed object
   changes whitespace and key order, which changes the hash and breaks verification. Parse a
   *copy* for your mapping logic; keep the original buffer for the MAC.
2. **Constant-time compare.** Never `===` on the hex string (early-exit timing leak). On Node use
   `crypto.timingSafeEqual` (guard equal length first); on Workers use `constantTimeEqual` from
   `../../api/src/lib/signing.ts` (length-checked XOR accumulate).
3. **Timestamp tolerance.** Reject when `abs(Date.now() - t) > toleranceMs`, default `300000`
   (±5 min). This is the replay defense.

> **Decision (2026-06): consume the millisecond (outbound) signature form, not the seconds form.**
> MailKite's outbound webhooks use a **millisecond** `t`; the internal SMTP-edge → `/api/ingest`
> path uses a **seconds** `t`. MailKite Mail only ever sees the outbound form. **Do not** copy
> `verifyIngestSignature` (seconds) from `../../api/src/lib/signing.ts` — copy the SDK's
> `MailKite.verifyWebhook` (milliseconds) instead.

Don't reinvent the primitives:

- **Node:** `import { MailKite } from 'mailkite'; MailKite.verifyWebhook(sig, rawBody, secret)`
  — uses `node:crypto` `timingSafeEqual`. See `../../sdks/node/index.js`.
- **Workers:** reuse the WebCrypto primitives in `../../api/src/lib/signing.ts`
  (`hmacSha256Hex`, `constantTimeEqual`) — the published Node SDK uses `node:crypto`, which is
  not available everywhere on Workers.

Return codes:

| Condition | Status | Why |
|---|---|---|
| Missing / empty signature header | `400` / `401` | never process unsigned input |
| Bad signature or stale timestamp | `401` | reject; do not write |
| Valid + durable write succeeded | `2xx` | acknowledge |
| Valid + duplicate (already stored) | `2xx` | idempotent ack — see §2.3 |
| Valid + write failed | `5xx` | let MailKite retry |

### 2.2 Secret config & rotation

The secret comes from env `MAILKITE_WEBHOOK_SECRET=whsec_*`.

> **Decision (2026-06): support a rotation overlap window.** A MailKite secret rotation
> invalidates the old `whsec_*`. During cutover, accept **both** the old and new secret (try new
> first, fall back to old) so no in-flight deliveries 401. Drop the old secret once rotation
> completes.

### 2.3 Idempotent ingest

MailKite **retries failed deliveries**, and a manual retry rebuilds the *identical* payload
(`buildWebhookPayload` reconstructs it from the stored message). So the same `payload.id` (`msg_*`)
can arrive two or more times.

- **Dedupe on `payload.id`.** It is stable across retries. Use `INSERT ... ON CONFLICT(id) DO
  NOTHING` (SQLite/D1) with `messages.id` as PRIMARY KEY.
- **Return `2xx` on a duplicate.** If you error on a dup, MailKite retries forever.
- **Treat ingest as upsert, not append.** Delivery order is not guaranteed; out-of-order and
  duplicate inserts must converge to the same state.
- **Don't dedupe on `threadId`** — it can be `null` on the first message of a thread.

> **Decision (2026-06): accept-then-process for heavy work.** Sanitizing HTML (§6) and rehosting
> attachments (§7) can be slow enough to time the handler out. Do the durable write of the core
> row first, return `2xx`, then defer heavy work (Workers `ctx.waitUntil`, or a Node queue/job).
> Idempotency on `payload.id` keeps deferred re-runs safe.

### 2.4 Payload → row mapping

The verified payload shape (from `buildWebhookPayload` in `../../api/src/index.ts`):

```json
{
  "id": "msg_…",
  "type": "email.received",
  "from": { "address": "alice@example.com" },
  "to":   [ { "address": "you@yourdomain.com" } ],
  "subject": "Hello",
  "text": "plain body",
  "html": "<p>html body</p>",
  "threadId": "msg_…|null",
  "auth": { "spf": "pass", "dkim": "pass", "dmarc": "pass", "spam": "0.1" },
  "attachments": [ { "id": "…", "filename": "a.pdf", "contentType": "application/pdf", "size": 1234, "url": "https://api.mailkite.dev/att/…?exp=…&sig=…" } ]
}
```

| Payload field | Local column | Notes |
|---|---|---|
| `id` | `messages.id` (PK) | dedupe key |
| `from.address` | `from_addr` | single address object |
| `to[].address` | `to_addr` (+ join table) | array; keep all recipients, render the first |
| `subject` | `subject` | nullable |
| `text` | `text_body` | store both bodies |
| `html` | `html_body` | render html, fall back to `text_body` |
| `threadId` | `thread_id` | nullable; **index it** |
| `auth.spf` / `dkim` / `dmarc` / `spam` | `spf` / `dkim` / `dmarc` / `spam` | display-only trust badges; route spam to a folder |
| `attachments[]` | `attachments` rows | metadata + (rehosted) bytes — see §7 |
| (server receive time) | `received_at` | the payload has **no timestamp body field**; use server clock |

> **Limitation:** the outbound webhook payload does **not** include `headers_json` (that exists
> only on the platform's own `GET /api/messages/:id`). MailKite Mail therefore derives threading
> from `threadId` alone (§3) — it never sees raw RFC5322 `References` / `In-Reply-To` on inbound.

See [`data-model.md`](data-model.md) for the full column definitions and indexes.

---

## 3. The reading path

The SPA reads only from the own store, never from MailKite. All endpoints are JWT-authed and
scoped to `c.var.userId` (§8).

| Endpoint | Returns | Backed by |
|---|---|---|
| `GET /api/messages` | list, newest first (`received_at` DESC) | `messages` |
| `GET /api/threads` | threads grouped by `thread_id`, latest message preview | `messages` grouped |
| `GET /api/messages/:id` | full row: bodies, auth badges, attachments, deliveries | `messages` + `attachments` |
| `POST /api/send` | sends a reply/compose (§5) and inserts the optimistic sent row | own store + `/v1/send` |

### Threading

- **Primary grouping is `thread_id`.** At ingest MailKite sets `thread_id = inReplyTo ?? messageId`
  (`processInbound` in `../../api/src/index.ts`), so a thread's id is its root message-id and
  every reply carries the same `threadId`. Order within a thread by `received_at`.
- `threadId === null` → a standalone message (root with no replies yet). Treat its own `id` as a
  one-message thread bucket for display.
- **No header-based fallback on inbound.** Because the webhook omits `References` / `In-Reply-To`,
  MailKite Mail cannot reconstruct threads from headers; it relies on MailKite's server-side
  `threadId`. Subject-based grouping (`Re:` stripping) is a possible heuristic fallback but is
  lossy — treat it as optional, off by default.

---

## 4. The sending path — `/v1/send`

Outbound is the **only** way mail leaves MailKite Mail. There is no SMTP. The Hono server makes
the call **server-side** with the MailKite API key — the key is never exposed to the SPA.

The SPA calls `POST /api/send` (JWT); Hono validates, then calls
`POST https://api.mailkite.dev/v1/send` (API key `mk_live_*`, env `MAILKITE_API_KEY`).

| Reply field | `/v1/send` field | Notes |
|---|---|---|
| sending identity | `from` | must be a verified MailKite domain address (an "identity") |
| recipient(s) | `to` (+ `cc` / `bcc`) | ≥1 required |
| subject | `subject` | typically `Re: <original>` |
| body | `html` / `text` | at least one required |
| reply-to override | `replyTo` | optional |
| **message-id replied to** | `inReplyTo` | drives RFC5322 `In-Reply-To` + `References` → threading |
| files | `attachments` | `{ filename, url \| content, contentType }` |

- **Validate before the upstream call.** Mirror the API's rules in Hono: require `from`, ≥1
  recipient, `subject`, and `html || text`. Fail fast for clean SPA errors; surface upstream
  failures as `502`.
- **`inReplyTo` closes the threading loop.** Pass the id of the message being replied to;
  MailKite auto-sets `In-Reply-To` + `References`, so the recipient's reply returns with the
  correct `threadId` on the next inbound webhook.
- `/v1/send` returns `202 { id, status: 'sent' }`. Insert an **optimistic local sent row** into the
  same `thread_id` bucket with `direction = 'outbound'`.
- **Identities** are MailKite's verified domain addresses; the SPA picks `from` from that list.
- Use the published `mailkite` SDK (`mk.send(...)`) on Node; raw `fetch` on Workers if the SDK is
  incompatible.

---

## 5. Rendering untrusted email safely

> **HTML email is hostile input and is the #1 attack surface in any webmail client.** A single
> rendering bug can exfiltrate the session JWT or run script in the SPA origin. Defense is in
> depth: sanitize **and** sandbox **and** apply CSP **and** proxy images — never just one.

### 5.1 Sanitize server-side (before or at render)

Run the stored `html_body` through a sanitizer (DOMPurify over `linkedom`/`jsdom` on Node; a
Worker-compatible sanitizer on Workers, ideally sanitizing **before** storing). Strip:

- `<script>`, and `<style>` containing `@import` / `expression(...)`
- all event-handler attributes (`on*`)
- `<iframe>`, `<object>`, `<embed>`, `<form>`, `<base>`
- `javascript:` and `data:` URLs (except known-safe inline image data)

### 5.2 Render in a locked-down iframe

Render the sanitized HTML in a **sandboxed iframe**:

```html
<iframe sandbox="" srcdoc="…sanitized html…"></iframe>
```

No `allow-scripts`, no `allow-same-origin`. Even a payload that slips past the sanitizer cannot
reach the SPA DOM, cookies, or the JWT in `localStorage`. Note the cost: without `allow-scripts`
there is no postMessage auto-height — measure on `load` or use a fixed scroll container.

### 5.3 Content-Security-Policy

Apply a strict CSP via Hono header middleware on **both** the SPA shell and the mail iframe:

```
default-src 'none';
img-src <proxy-origin>;
style-src 'unsafe-inline';   /* inline styles in mail are unavoidable */
script-src 'none';
frame-ancestors 'self';
base-uri 'none';
```

### 5.4 Image proxying & links

- **Never let untrusted HTML load remote images directly** — tracking pixels, IP leak, referrer
  leak. Route every `<img>` through a Hono proxy (`/api/proxy/img?u=…`) with an allowlist and a
  size cap, **or** block remote images by default behind a "load images" toggle (standard webmail
  behavior). Inline `cid:` images map to attachments via `content_id`.
- Rewrite every link to `target="_blank" rel="noopener noreferrer nofollow"`; strip `<a ping>`;
  optionally route through a confirm interstitial.
- **Prefer `text` when `html` is absent**, and **always sanitize regardless of `auth` verdicts** —
  `spf` / `dkim` / `dmarc` are display-only badges and must never be used to relax sanitization.

---

## 6. Attachments

Each attachment in the payload carries a signed URL:

```
https://api.mailkite.dev/att/<mid>/<idx>?exp=<unixSec>&sig=<hex>
```

The signature is `HMAC(att_secret, "<key>\n<exp>")` where `key = att/<mid>/<idx>` — see
`signedAttachmentUrl` and the `GET /att/:mid/:idx` route in `../../api/src/index.ts`. **No login
is required** to fetch it; the signed URL *is* the authorization. The URL is valid for **7 days**,
and the underlying object is lifecycle-deleted at 7 days.

> **Decision (2026-06): rehost attachments into the own store at ingest.** The webhook delivers a
> *fresh* URL each delivery, but MailKite Mail stores it once. After 7 days the link `410`s and the
> bytes are gone — old mail silently loses its attachments. Store the **metadata**
> (`filename`, `contentType`, `size`, `id`) permanently and treat `url` as ephemeral, then
> **fetch-and-rehost** the bytes (R2 on Workers / local FS or SQLite blob on Node) inside the
> 7-day window. Trade-off: storage cost vs. depending on MailKite's retention. Recommended:
> rehost. This is exactly the "heavy work" the accept-then-process pattern in §2.3 defers.

Serving rehosted bytes back to the SPA goes through an authed `/api/*` route (or a re-signed local
URL); the original MailKite signed URL is only used transiently during rehosting.

---

## 7. Auth model

MailKite Mail issues its **own** session, mirroring `../../dashboard/src/lib/api.ts`.

- **Login** → Hono mints an HS256 JWT (`hono/jwt`, 7-day exp).
- **Storage** → SPA keeps it in `localStorage` under key `mailkite_token` (the dashboard's
  convention; see `../../dashboard/src/lib/auth.tsx` and `../../dashboard/src/router.tsx`).
- **Every `/api/*` call** sends `Authorization: Bearer <jwt>`.
- **`requireAuth` middleware** verifies the JWT, sets `c.var.userId`, and **scopes every store
  query** to that user. A single-user self-host still keeps the JWT — simpler than a separate
  unauth mode.

The two route groups never mix: `POST /webhook` is HMAC-only (no JWT); `/api/*` is JWT-only (no
HMAC).

> **Decision (2026-06): keep the JWT unreachable from the mail iframe.** The dashboard stores its
> token in `localStorage`, which is XSS-readable. Because §5 renders untrusted HTML, that is a real
> risk — *unless* the mail is rendered in a `sandbox=""` iframe with no `allow-same-origin`, in
> which case the iframe cannot read the parent's `localStorage` at all. That sandboxing is what
> makes `localStorage` acceptable here. The stronger alternative is an httpOnly cookie + CSRF
> token. Either way, the JWT and the MailKite API key must never be reachable from rendered email.

---

## 8. Risks at a glance

| # | Risk | Mitigation |
|---|---|---|
| 1 | HTML rendering (XSS / exfil) — **the big one** | sanitize + `sandbox=""` iframe + strict CSP + image proxy (§5) |
| 2 | Signature pitfalls (re-serialized body, non-const-time, ms-vs-s, no replay window) | §2.1 — raw bytes, `timingSafeEqual`/`constantTimeEqual`, ms form, ±5 min |
| 3 | Attachment 7-day expiry/deletion | rehost at ingest; metadata permanent (§6) |
| 4 | Duplicate retried webhooks | dedupe on `payload.id`, `2xx` on dup (§2.3) |
| 5 | Webhook secret rotation invalidates old `whsec` | accept old + new during overlap (§2.2) |
| 6 | Threading limited to `threadId`; null edge cases | server-side `threadId`; standalone buckets (§3) |
| 7 | Credential exposure | `mk_live_*` stays server-side; SPA only talks to local `/api` (§4, §7) |
| 8 | Handler timeouts on heavy work | accept-then-process; durable write first, defer the rest (§2.3) |

---

## Related docs

- [`stack.md`](stack.md) — dual Node/Workers Hono target, Vite SPA, design tokens.
- [`data-model.md`](data-model.md) — table & column definitions for the own store.
- [`webhook-signatures.md`](../../docs/architecture/webhook-signatures.md) — the platform signature scheme.
- Code references: `../../api/src/lib/signing.ts`, `../../api/src/index.ts`,
  `../../sdks/node/index.js`, `../../dashboard/src/lib/api.ts`.
