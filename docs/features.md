# MailKite Mail — Features

> **One-liner:** A deliberately small "read + reply" inbox where threading, sender-auth badges, and spam score arrive **pre-computed in the webhook** — so the hard parts of an IMAP client are nearly free, and we spend our budget on a fast, keyboard-driven, privacy-leaning UI instead.

This doc is the feature map: what MailKite Mail does, how each feature works given the [webhook-only architecture](00-overview.md), and which tier it lands in. It supersedes the feature sketch in [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) and assumes the locked decisions in [`00-overview.md`](00-overview.md) and [`install.md`](install.md): **own store** (SQLite/D1) populated only by the `email.received` webhook, **outbound only** via `POST /v1/send`, no IMAP/POP/SMTP-receive, never touch MailKite's internal DB.

The whole design follows from one fact: **we own every bit of mailbox state.** Read/unread, stars, labels, trash, snooze — none of it is two-way-synced against an IMAP server. There is no `\Seen` flag to reconcile, no conflict resolution, no folder hierarchy to mirror. That is why labels, arbitrary saved views, and HEY-style piles are cheap, and why this client can stay thin and forkable (the [Nylas Mail lesson](#5-what-we-deliberately-dont-build): decouple from platform internals so the OSS community can carry it).

---

## 1. The three things we get for free

Before the inventory, the framing. Three features that are genuinely hard in a traditional IMAP client are handed to us pre-computed in every webhook payload (see the payload shape in [`00-overview.md`](00-overview.md) and [`../../api/src/index.ts`](../../api/src/index.ts)):

| Pre-computed field | What it normally costs an IMAP client | What it costs us |
|---|---|---|
| `threadId` | Parsing `References`/`In-Reply-To`/`Message-ID` headers and subject-normalizing to build conversations | Group rows by `threadId`. Done. |
| `auth: { spf, dkim, dmarc, spam }` | Running your own SPF/DKIM/DMARC validation, or trusting opaque `Authentication-Results` | Render a trust badge straight from the payload. |
| `auth.spam` (score) | Bolting on SpamAssassin/rspamd and a training loop | Route high scores to a Spam view at ingest. |

> **Decision (2026-06): lead with the webhook's pre-computed fields.** "No IMAP" is not a limitation to apologize for — it is why threading, sender-auth display, and spam routing are basically free here. The MVP builds directly on `threadId` and `auth.*` rather than re-deriving them.

---

## 2. Design principles

- **Simple.** One mailbox, one model. We pick **labels over folders**, one curated set of keyboard shortcuts (Gmail's), and one scheduling primitive. Fewer concepts beats more features.
- **Modern.** React 19 + Vite + TanStack Router + shadcn/ui + Tailwind CSS 4, the same stack as `dashboard/`. Design tokens are lifted verbatim from [`../../website/src/styles/global.css`](../../website/src/styles/global.css) (dark `--color-bg #0b0d12`, light `#ffffff`, accent `#6ea8fe`); theme via `html[data-theme="light"]`. See [`stack.md`](stack.md).
- **Fast.** Mail lives in our own store, so list, search, and read are local DB reads — no network round-trip per open. A command palette (`Cmd+K`) plus Gmail keybindings is the primary interaction surface.
- **Keyboard-friendly.** Adopt Gmail's bindings verbatim for muscle memory; surface them through a discoverable palette so no one has to memorize 30 keys.
- **Private by default.** Remote images blocked until you ask, mandatory HTML sanitization, sender-auth badges, and **no outbound open-tracking, ever** (see [§ Security](#310-security--privacy)). On-brand for an OSS, minimal client.

---

## 3. Feature inventory

Tier legend: **V1** = ships in the minimal MVP · **V2** = fast-follow, feasible with today's payload · **Later** = nontrivial, lower value, or **blocked-on-platform** (needs MailKite to extend the webhook payload — see the [decision record below](#4-the-central-limitation-the-ccbccheaders-gap)).

How-it-works tags: **Native** (we own the data / pure UI) · **Local-derived** (computed from our stored mail) · **Send-path** (works through `/v1/send`) · **Platform-dep** (needs a new payload field/endpoint) · **Infeasible** (conflicts with a locked constraint).

### 3.1 Reading

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Threaded conversation view | **Local-derived.** Group by the `threadId` handed to us in the payload; no header parsing. The single biggest win, essentially free. | **V1** |
| 3-pane reading layout | **Native** UI mirroring the dashboard shadcn layout; collapses to list+detail on narrow widths. | **V1** |
| Read / unread | **Native.** Our own boolean column — no `\Seen` sync. Mark-on-open + bulk mark. | **V1** |
| Quote collapse / trim history | **Local-derived.** Strip trailing quoted blocks from `text`/`html` for a clean thread view (sanitization required regardless). | **V2** |
| Stars / flags | **Native** boolean. Trivial since state is ours; single star for V1, colors later. | **V2** |
| Snooze | **Local-derived** `snooze_until` column + the shared [scheduler](#6-architecture-levers). Un-snoozes back to Inbox. No platform dependency. | **V2** |
| Mute thread | **Native** per-thread flag; future webhook messages on the thread skip Inbox. | **V2** |
| List density toggle (comfortable/compact) | **Native** CSS + setting. | **Later** |
| Auto-advance after archive/delete | **Native** UI nicety. | **Later** |
| HEY-style **Screener** (approve first-time senders) | **Local-derived.** Sender allowlist table; unknown `from.address` → held in a Screener view instead of Inbox. Strong fit — we control ingest routing. | **Later** |
| HEY-style **Reply Later** / **Set Aside** piles | **Local-derived.** Each is just a reserved label + a curated view. Cheap differentiator. | **Later** |
| HEY-style **Paper Trail** (receipts) | **Local-derived** heuristic; needs a classifier. Punt until a rules engine exists. | **Later** |

### 3.2 Composing

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Reply (with threading) | **Send-path.** Pass the original message `id` as `inReplyTo`; `/v1/send` auto-sets `In-Reply-To` + `References`. Exactly what the API was built for. | **V1** |
| Quote original on reply | **Local-derived.** Prepend the stored `text`/`html` client-side. | **V1** |
| Rich-text (HTML) compose | **Send-path.** Lightweight editor (Tiptap/contentEditable) → sanitized HTML → `html` field. | **V1** |
| Plaintext compose | **Send-path.** Always send `text` alongside `html` for deliverability. | **V1** |
| cc / bcc on **send** | **Send-path.** `/v1/send` supports `cc`/`bcc` — settable outbound even though they are not visible inbound (see [§4](#4-the-central-limitation-the-ccbccheaders-gap)). | **V1** |
| Attachments on send | **Send-path.** Upload path → encode/host → `attachments` field. | **V2** |
| Forward | **Send-path.** Re-send stored body via `/v1/send`. | **V2** |
| Drafts | **Local-derived** `drafts` table with autosave. Never touches an IMAP Drafts folder. | **V2** |
| Signatures (per identity) | **Local-derived** setting injected at compose. | **V2** |
| Schedule send / Send Later | **Local-derived.** Hold draft, the shared [scheduler](#6-architecture-levers) calls `/v1/send` at fire time. | **V2** |
| **Reply-all** | **Platform-dep.** The payload gives `to[]` but **not `cc`**, so we cannot reconstruct the full original recipient set. V1 replies to sender only; true reply-all is blocked on the webhook gaining `cc`. | **Later** |
| Undo send | **Local-derived.** Buffer 5–30s before actually calling `/v1/send`. | **Later** |
| Reply-To override | **Send-path** `replyTo` field. | **Later** |
| Snippets / canned responses | **Local-derived** text blobs inserted at compose. | **Later** |
| Custom headers | **Send-path** `headers` field; power feature. | **Later** |
| AI compose / instant replies | **Send-path** + external LLM. MailKite has an agent surface, but keep the webmail lean. | **Later** |
| Read receipts / open tracking (outbound) | **Infeasible / anti-goal.** Requires a tracking pixel + callback; conflicts with our privacy stance. Will not ship. | **Never** |

### 3.3 Organizing

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Archive | **Native** state flag — drop from Inbox view, keep in All Mail. | **V1** |
| Trash (soft-delete + restore) | **Native** soft-delete column + retention purge. | **V1** |
| Labels (multi, overlapping) | **Native** join table — one message ↔ many labels. The primary organization model. | **V2** |
| Spam view | **Native.** Seeded from `auth.spam` in the payload — classification is partly done upstream. | **V2** |
| Reserved "system" labels as folders | **Native.** Inbox / Sent / Archive / Trash / Spam are presented as folders but are really reserved labels — one model, two names. | **V2** |
| Sweep (bulk by sender) | **Local-derived** bulk action over local mail. | **Later** |
| Focused / Split inbox views | **Local-derived** saved-query views (e.g. VIP split). | **Later** |
| VIP / important sender | **Local-derived** allowlist; pairs with Screener and Splits. | **Later** |
| Rules / filters engine | **Local-derived**, run in the webhook receiver before insert: match `from`/`to`/`subject`/`auth.spam` → label/archive/snooze/screener. App-level only — **not** server Sieve. Header/cc conditions are **Platform-dep**. See [§4](#4-the-central-limitation-the-ccbccheaders-gap) and [§5](#5-what-we-deliberately-dont-build). | **Later** |

### 3.4 Contacts

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Recipient autocomplete | **Local-derived** from seen `from`/`to` addresses + manual entries. High value, easy. | **V2** |
| Address book | **Local-derived**, auto-populated from incoming `from.address`. No CardDAV. | **Later** |
| vCard import / export | **Native** file handling; OSS parity, low MVP value. | **Later** |
| Avatars / enrichment | **Local-derived** initials or opt-in Gravatar only — avoid third-party leaks. | **Later** |

### 3.5 Attachments

| Feature | Notes / how it works here | Tier |
|---|---|---|
| List + download attachments | **Native.** Payload gives `{id,filename,contentType,size,url}`. **Gotcha:** `url` is a signed **7-day** link — it expires. See the durability decision below. | **V1** |
| Inline images (`cid:`) | **Local-derived.** Rewrite `cid:` refs in `html` to stored attachment URLs. Payload does not map `cid` explicitly → match by filename/contentType. Partial. | **V2** |
| Attachment preview (image/PDF) | **Native** once bytes are local. | **Later** |
| Drag-out / save | **Native.** | **Later** |

> **Decision (2026-06): fetch-and-store attachments at ingest.** MailKite's `attachments[].url` are signed **7-day** URLs (`GET /att/:mid/:idx?exp=&sig=`). If we only store the URL, mail "rots" after a week. The portable choice is to **fetch the bytes at webhook time** and persist them (R2 on Workers, filesystem/SQLite blob on Node). Re-minting via MailKite is **Platform-dep** and breaks the "own store" portability story, so we don't rely on it.

### 3.6 Search

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Full-text search | **Local-derived.** Node: `better-sqlite3` + FTS5 virtual table. **Gotcha: D1 has no FTS5** — on Workers use `LIKE` or a maintained tokenized column. We index only what we store (subject/from/text/html). | **V1** |
| Search operators (Gmail subset) | **Local-derived.** Supported: `from:`, `to:`, `subject:`, `has:attachment`, `filename:`, `is:unread`/`read`/`starred`/`spam`/`snoozed`, `label:`/`in:`, `before:`/`after:`/`older_than:`/`newer_than:`, `"phrase"`, `-exclude`, `OR`/`AND`/`()`. | **V2** |
| `cc:` / `bcc:` / `list:` / `rfc822msgid:` | **Platform-dep.** These fields are not in the payload. `to:` works but won't include cc'd recipients. See [§4](#4-the-central-limitation-the-ccbccheaders-gap). | **Later** |

### 3.7 Settings

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Dark / light theme | **Native.** Tokens lifted from [`../../website/src/styles/global.css`](../../website/src/styles/global.css); `html[data-theme]` + system preference + manual toggle. | **V1** |
| Single mailbox (one account) | **Native.** One API key + one `whsec_*` = one mailbox. The locked self-host story. | **V1** |
| Signature editor | **Native** setting (also [§3.2](#32-composing)). | **V2** |
| Density / reading-pane position / layout | **Native** settings. | **Later** |
| Multiple identities / send-as aliases | **Send-path.** `from` is settable on `/v1/send`; inbound for an alias just arrives via webhook. | **Later** |
| Custom themes / accent | **Native** CSS-var override — cheap given the token system. | **Later** |
| Vacation responder / auto-reply | **Send-path** + ingest trigger. Doable but loop-risk; gate carefully. | **Later** |
| Unified inbox across accounts | **Local-derived** if we ingest N webhook sources, but multiplies config (N keys/secrets). Keep V1 single-account. | **Later** |
| Masked / alias generation | **Platform-dep.** MailKite owns address creation (`/api/domains/subdomain`); out of webmail scope. | **Later** |

### 3.8 Keyboard & navigation

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Core Gmail shortcuts | **Native.** `c` compose, `r` reply, `e` archive, `j`/`k` navigate, `Enter`/`o` open, `u` back, `/` search, `?` help overlay. | **V1** |
| Command palette (`Cmd+K`) | **Native.** Superhuman/Fastmail pattern; the primary discoverability surface — one palette beats memorizing 30 keys. | **V2** |
| Full shortcut set | **Native.** `a` reply-all, `f` forward, `#` delete, `b` snooze, `s` star, `z` undo, `x` select, `g i/t/d/a` go-to views, `Cmd/Ctrl+Enter` send. | **V2** |

### 3.9 Mobile / PWA

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Responsive layout | **Native.** shadcn/Tailwind responsive: degrade 3-pane → list+detail. | **V2** |
| PWA (installable, offline read) | **Native.** Offline reading is natural since mail is in our own store; offline-compose queue flushes to `/v1/send` on reconnect. | **Later** |
| Push notifications | **Native** + Platform-dep-ish. We know at ingest time that mail arrived → fire Web Push (needs VAPID + subscription store). | **Later** |

### 3.10 Security & privacy

| Feature | Notes / how it works here | Tier |
|---|---|---|
| Webhook signature verification | **Native, security-critical.** Verify `x-mailkite-signature` (`t=<ms>,v1=<hmac>`) via `MailKite.verifyWebhook(sig, rawBody, secret, toleranceMs)` from the `mailkite` SDK — HMAC-SHA256 over `"<t>." + rawBody`, default 5-min tolerance, per-account `whsec_*`. **Reject on failure.** This is the front door of the whole app. | **V1** |
| HTML sanitization | **Native, non-negotiable.** Sanitize every `html` body (DOMPurify-class) — strip scripts, event handlers, dangerous CSS — and render in a sandboxed iframe. | **V1** |
| SPF / DKIM / DMARC badge | **Native.** Render straight from `auth.{spf,dkim,dmarc}`. Almost no other client hands the UI pre-computed auth results — a free, high-trust win. | **V2** |
| Spam score display / routing | **Native** from `auth.spam` (also [§3.3](#33-organizing)). | **V2** |
| Block remote images by default | **Native.** Default-block remote `<img>`/CSS backgrounds to defeat tracking pixels; per-sender "load images" allow. | **V2** |
| Image proxying (hide IP) | **Native** — a `/img-proxy?url=` route in the Hono app fetches server-side. Trade-off: server bandwidth, and it still registers an "open." | **Later** |
| Link safety / strip trackers | **Native.** Annotate/strip known tracker params; warn on redirect domains. | **Later** |

---

## 4. The central limitation: the cc/bcc/headers gap

One gap shapes the "Later" column more than anything else. The `email.received` webhook delivers `from`, `to[]`, `subject`, `text`, `html`, `threadId`, `auth.*`, and `attachments[]` — but **not**: `cc`/`bcc` recipients, raw RFC822 headers, `Message-ID`, `Date`, `Reply-To`, or `List-*` headers.

> **Decision (2026-06): degrade, don't depend on MailKite internals.** MailKite's own `GET /api/messages/:id` does expose `headers_json` + `deliveries`, but reaching into MailKite's store would break the OSS portability contract (own store, two secrets, nothing else — see [`install.md`](install.md)). So for the OSS build we use **only the webhook fields** and explicitly degrade anything that needs more. The fix is a **single platform ask: extend the webhook payload** with `cc`, `bcc`, and selected headers (`Message-ID`, `Reply-To`, `List-Unsubscribe`).

What the gap degrades (everything else is feasible locally):

| Feature | Why it's blocked | Unblocked by |
|---|---|---|
| True **reply-all** | Can't reconstruct the original recipient set without `cc` | `cc` in payload |
| `cc:` / `bcc:` search operators | Fields absent | `cc`/`bcc` in payload |
| `list:` search, **List-Unsubscribe** one-click | No `List-*` headers | header subset in payload |
| `rfc822msgid:` search | No `Message-ID` | `Message-ID` in payload |
| Header-condition rules | No raw headers to match | header subset in payload |

`to:` search and display **do** work (the payload has `to[]`) — they just won't include cc'd recipients. Surface that caveat in the UI.

---

## 5. What we deliberately DON'T build

Being opinionated about the "no" list is how V1 stays small.

| Not building | Why |
|---|---|
| **IMAP/POP/SMTP-receive of any kind** | Locked architecture: mail arrives **only** via webhook. No mail server, no folder sync, no `\Seen` reconciliation, no two-way conflict resolution. This constraint is the product. |
| **Folders as an IMAP-synced hierarchy** | We pick **labels** as the one model; "folders" (Inbox/Sent/Archive/Trash/Spam) are just reserved labels. One model = simpler OSS UX and no nested-mailbox sync to maintain. |
| **A full filter/Sieve engine in V1** | Server-side Sieve is IMAP-world and unavailable to us. Our rules run app-level in the webhook receiver, limited to payload fields — shipped as **Later**, not V1, to keep the MVP focused on read + reply. |
| **Reaching into MailKite's internal DB** | Breaks the portability contract (two secrets, own store). The `headers_json`/`deliveries` MailKite exposes stay off-limits for the OSS build. |
| **Outbound open-tracking / read receipts** | Anti-goal. Requires a tracking pixel + callback; conflicts with the privacy posture. Will not ship. |
| **AI compose / smart-reply in V1** | MailKite has an agent surface, but the webmail stays lean; revisit as **Later**. |
| **Masked-email / alias generation** | MailKite owns address creation; minting addresses is a platform concern, not a webmail one. |
| **Multi-account unified inbox in V1** | Feasible but multiplies config (N keys/secrets). V1 is one account; multi is documented as advanced/**Later**. |

---

## 6. Architecture levers

Two observations that collapse many features into one piece of work each — build the primitive once and the features fall out:

- **One scheduler.** Snooze, schedule-send, send-later, undo-send, and the vacation responder are all "do a thing at time T." Build **one** scheduling primitive — a Durable Object alarm or Cron Trigger on Workers, `node-cron`/`setInterval` on Node — and all of them become thin features on top. No platform dependency.
- **One ingest seam.** Rules, spam routing, Screener, attachment fetch-and-store, and push notifications all hook the same point: the verified webhook receiver, **before** the row is inserted. Get verification + the rule pass right once.

See [`stack.md`](stack.md) for where these live in `src/index.ts`.

---

## 7. The V1 cut (checklist)

Keep it small. V1 is **read + reply + portable ingest**, nothing more:

- [ ] **Verified webhook ingestion** — `MailKite.verifyWebhook`, reject on bad signature (the front door).
- [ ] **Own store** populated by `email.received` — SQLite on Node, D1 on Workers.
- [ ] **Threaded view** grouped by `threadId`.
- [ ] **3-pane reading layout** (degrades to list+detail on mobile).
- [ ] **Read / unread**, **archive**, **trash** (soft-delete).
- [ ] **HTML sanitization** + sandboxed render (non-negotiable).
- [ ] **Full-text search** (FTS5 on Node, `LIKE`/tokenized column on D1).
- [ ] **Reply** with `inReplyTo` threading + quoted original.
- [ ] **Rich-text & plaintext compose**, with **cc/bcc on send**.
- [ ] **Attachment list/download** with **fetch-and-store at ingest**.
- [ ] **Dark/light theme** from the locked design tokens.
- [ ] **Core keyboard shortcuts** + `?` help overlay.

Everything in [§3](#3-feature-inventory) tagged **V2** or **Later** is out of V1 by design. When in doubt, cut it.

---

## See also

- [`00-overview.md`](00-overview.md) — what MailKite Mail is and the webhook/`send` boundary.
- [`install.md`](install.md) — the dual-target install + own-store decision.
- [`stack.md`](stack.md) — Hono + React/Vite stack and where ingest/scheduler live.
- [`../../api/src/index.ts`](../../api/src/index.ts) — the verified API surface: `/api/ingest`, `GET /api/messages`, `POST /v1/send`, `GET /att/:mid/:idx`.
