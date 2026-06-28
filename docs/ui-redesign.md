# MailKite Mail — UI Redesign: **Unified Light**

> Research convergence + feature spec + phased implementation plan.
> Companion artifact: the clickable mockup at
> [`apps/web/public/ui-explorations.html`](../apps/web/public/ui-explorations.html)
> — open it and select the **☼ E · Unified · Light** tab (`…#e`).
> The dark twin is tab **D**; the three source explorations are **A/B/C**;
> the client research is the **Research** tab.

---

## 1. Decision

We are replacing the current basic three‑pane webmail UI (rail · list · reading)
with **Unified Light** — a three‑column, keyboard‑first, AI‑assisted inbox in a
calm light theme. It is the convergence of three explorations (Focus, Flow,
Copilot) into one layout, then re‑skinned in the Focus palette.

**Why this one:** it keeps the product's existing bones (the same `/api/messages`
contract, the same own‑store) while layering on the triage, organization, AI, and
speed affordances that every modern client (Gmail, Apple Mail, Superhuman,
Shortwave, HEY, Notion Mail, Spark, Missive, Proton, Canary) now ships. Light +
single‑accent reads as "calm and fast" rather than "dense and busy," which fits a
self‑hostable product whose differentiator is *simplicity*, not feature sprawl.

---

## 2. How we got here (research convergence)

Ten clients were surveyed (2025–2026). The recurring, load‑bearing patterns —
and where each lands in Unified Light:

| Pattern | Seen in | Lands in Unified Light |
|---|---|---|
| Split / category inbox | Gmail tabs, Apple Categories, Superhuman Splits | **Boxes** (Priority / Feed / Receipts) |
| Saved filtered slices | Notion Mail Views, Gmail multiple‑inboxes | **Views** (left rail, user‑defined) |
| Grouping similar mail | Shortwave Bundles, Spark Smart Inbox | **Bundles** (Newsletters / Notifications) |
| Consent‑based receiving | HEY Screener | **Screener** banner |
| Defer/triage stacks | HEY Reply‑Later / Set‑Aside, Gmail/Apple Snooze | **Reply Later · Set Aside · Snooze** |
| Keyboard‑first + ⌘K | Superhuman, Notion Mail | **Command palette + shortcuts** |
| Thread summary at top | Apple Intelligence, Gmail Gemini, Shortwave | **AI summary** (assistant panel) |
| Smart‑reply chips | Gmail, Apple, Spark | **Smart replies** |
| To‑dos from email | Shortwave (press T) | **Extracted to‑dos** |
| Assistant beside thread | Shortwave, Canary Copilot, Missive | **Assistant panel** (right column) |
| Natural‑language search | Shortwave, Canary, Gmail | **Ask‑anything header** |
| On‑device AI / privacy | Proton Scribe, Canary | **`on-device` posture** (provider‑pluggable) |
| Auth visibility | (MailKite already has this) | **SPF/DKIM/DMARC chips** (shipped) |

Five explorations were built (A Focus · B Flow · C Copilot · D Unified · E
Unified Light). **E won** because it is the only one that is simultaneously
calm (Focus), triage‑complete (Flow), and AI‑native (Copilot).

---

## 3. The design at a glance

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ✦ Ask anything — "what did Sarah say about the deadline?"        ⌘K   (G) │  ← NL search / command header
├───────────────┬───────────────────────────────────────────┬───────────────┤
│  SCREENER      │  Priority            J K move · E archive  │  ✦ Assistant  │
│  2 new senders │ ┌───────────────────────────────────────┐ │  on-device    │
│  [Let in][out] │ │ SC Sarah Chen              9:02        │ │ ┌───────────┐ │
│                │ │    Q3 launch timeline — sign-off       │ │ │ Summary   │ │
│  FLOW          │ │    ✦ Needs your OK on July 14          │ │ └───────────┘ │
│  📥 Priority 5 │ │   [↩ Reply later L][📎 Set aside S]…   │ │ ┌───────────┐ │
│  📰 The Feed   │ └───────────────────────────────────────┘ │ │ ✦ To-dos  │ │
│  🧾 Receipts   │   M  Marco Reyes   VIP                     │ │ └───────────┘ │
│  BUNDLES       │   A  Aisha Khan                            │ │ ┌───────────┐ │
│  ✉️ Newsletters│   ✉️ Newsletters · 9 bundled  [Open]       │ │ │ Smart rep │ │
│  🔔 Notifs     │                                            │ │ └───────────┘ │
│  VIEWS         │                                            │ │  chat …       │
│  ⚡ Action req │                                            │ │               │
│  ⏳ Awaiting   │ ↩ Reply Later (3)  📎 Set Aside (2)        │ │ [Ask/instruct]│
│  + New view    │            Inbox Zero in 3  [Focus&Reply→] │ │               │
│  ✦ Organize    │                                            │ │               │
└───────────────┴───────────────────────────────────────────┴───────────────┘
   COLUMN 1: Flow boxes + Views        COLUMN 2: triage list      COLUMN 3: Assistant
```

**Theme tokens (Focus / light):**

| Token | Value |
|---|---|
| App surface | `#f7f8fa` |
| Card / panel | `#ffffff` |
| Border | `slate-200` |
| Primary text | `slate-900` |
| Muted text | `slate-500` |
| **Accent (single)** | `indigo-600` (hover `indigo-500`) |
| Triage warmth | `amber-400` (Reply Later, Screener, Priority badge) |
| Positive | `emerald-500` (Let in) |
| Avatars | per‑sender hashed hue |
| Radius | `xl` (12px) cards, `lg` (8px) controls |
| Font | system UI stack |

Dark mode = the **D** palette; the theme switch already exists
(`packages/ui/src/theme/ThemeProvider.tsx`), so ship light + dark from one token set.

---

## 4. Feature catalog — what each entails

Each feature lists: **What** · **Behavior** · **Data** · **API** · **Inspiration** ·
**MailKite fit**. "Shipped" = already in the codebase today.

### 4.1 Three‑column app shell + light theme
- **What:** Header (NL search) + left rail (Flow/Views) + center list + right Assistant.
- **Behavior:** Columns are independently scrollable; Assistant collapsible; below
  `lg` the layout reflows to a single column with a bottom tab bar (mobile).
- **Data:** none.
- **API:** none.
- **Inspiration:** Shortwave / Copilot three‑pane.
- **MailKite fit:** Replaces `AppShell.tsx` + `MailApp.tsx` layout. Reuses existing
  `ThemeProvider`, `Avatar`, `Logo`.

### 4.2 Boxes — Priority / Feed / Receipts
- **What:** Three top‑level "boxes" that split incoming mail by intent.
- **Behavior:** Priority = mail from real people that needs you; Feed =
  newsletters/social/updates; Receipts = transactional/order/confirmation mail.
- **Data:** add `messages.category TEXT` (`'priority' | 'feed' | 'receipts'`),
  computed at ingest by heuristics: `List-Unsubscribe`/bulk headers → feed; receipt
  keywords + known transactional senders → receipts; otherwise priority. Store the
  raw signal so it can be re‑derived if rules change.
- **API:** `GET /api/messages?box=priority|feed|receipts` (extends today's `folder`).
- **Inspiration:** HEY Imbox/Feed/Paper Trail; Apple Categories.
- **MailKite fit:** Ingest hook lives in `MailRepo.ingestWebhookMessage`
  (`packages/core/src/server/repo.ts`). Heuristics are deterministic (no AI needed).

### 4.3 Views — saved filtered slices
- **What:** User‑defined saved searches that reshape the list (e.g. "Awaiting reply").
- **Behavior:** A View is a named, ordered filter (box + query + flags). Selecting it
  swaps the center list. Seed defaults: *Action required* (unread + priority),
  *Awaiting reply* (sent, no inbound since), *From people* (priority, non‑bulk).
- **Data:** new table `views(id, user_id, name, filter_json, position, created_at)`.
- **API:** `GET/POST/PATCH/DELETE /api/views`; list filtering accepts `view=<id>`.
- **Inspiration:** Notion Mail Views; Gmail multiple inboxes.
- **MailKite fit:** Per‑user, ACL‑scoped via the existing `Actor`.

### 4.4 Bundles
- **What:** Collapse many similar low‑priority messages into one expandable row.
- **Behavior:** Newsletters / Notifications collapse to a single card with sender
  faces + count; "Open" expands, "Mark all read" / bulk‑archive act on the group.
- **Data:** derived (group Feed by sender‑domain or category) — **no schema change**
  for v1; can promote to a `bundles` table later if users rename/pin them.
- **API:** reuse list endpoint; group client‑side, or add `groupBy=sender` server‑side.
- **Inspiration:** Shortwave Bundles; Spark Smart Inbox.
- **MailKite fit:** Pure presentation initially — lowest‑risk way to cut clutter.

### 4.5 Screener
- **What:** First‑time senders are held until you allow or block them.
- **Behavior:** Unknown `from_addr` on ingest → `pending`, kept out of the boxes and
  surfaced in a Screener banner. "Let in" → future mail flows + backfills held mail;
  "Screen out" → silently archived/dropped.
- **Data:** new table `screened_senders(from_addr, decision, decided_at)` where
  `decision ∈ {pending, allowed, blocked}`; messages from `pending`/`blocked` get a
  `screen_state` so the list can exclude them.
- **API:** `GET /api/screener` (pending list), `POST /api/screener/:addr {decision}`.
- **Inspiration:** HEY Screener.
- **MailKite fit:** Opt‑in (off by default) — it changes delivery semantics, so gate
  it behind a setting like the existing `ADDRESS_MODE`.

### 4.6 Triage actions — Archive · Snooze · Reply Later · Set Aside
- **What:** The four verbs that move a message out of the way.
- **Behavior:**
  - **Archive** (`E`) — shipped (`archived` flag).
  - **Snooze** (`H`) — hide until a chosen time, then resurface at top of its box.
  - **Reply Later** (`L`) — push to a bottom **Reply Later** stack; "Focus & Reply"
    opens them one after another.
  - **Set Aside** (`S`) — pin reference mail to a bottom **Set Aside** stack.
- **Data:** extend `messages` with `snooze_until INTEGER NULL`,
  `reply_later INTEGER NOT NULL DEFAULT 0`, `set_aside INTEGER NOT NULL DEFAULT 0`,
  plus `reply_later_pos`/`set_aside_pos` for stack ordering.
- **API:** extend `PATCH /api/messages/:id` (today handles `unread/starred/archived`)
  to accept the new flags; list filters: `box`/`view` exclude snoozed‑in‑future,
  dedicated `reply_later` / `set_aside` queues. A due‑snooze sweep (on list load, set
  `snooze_until` ≤ now back to visible) avoids needing a cron.
- **Inspiration:** HEY (Reply Later / Set Aside); Gmail/Apple (Snooze).
- **MailKite fit:** Mirrors the shipped flag plumbing in `MailRepo.updateFlags`.

### 4.7 Keyboard‑first + Command palette (⌘K)
- **What:** Every action reachable by keyboard; ⌘K opens a fuzzy action/search palette.
- **Behavior:** `J/K` move, `E` archive, `R` reply, `L/S/H` triage, `?` shows help.
  ⌘K lists context actions ("Snooze until tomorrow 9am", "Move to View…", "Summarize
  thread") and falls through to search. Optimistic UI: apply visually before the
  server confirms (<100 ms feel).
- **Data:** none.
- **API:** none (composes existing endpoints).
- **Inspiration:** Superhuman; Notion Mail.
- **MailKite fit:** New `useHotkeys` hook + `<CommandPalette/>` in `packages/ui`.

### 4.8 Natural‑language search (Ask‑anything header)
- **What:** The header bar accepts plain‑English queries.
- **Behavior:** Two modes — literal keyword search (works with no AI) and, when an AI
  provider is configured, semantic answers ("what did Sarah say about the deadline?").
- **Data:** v1 uses existing `q` keyword search; semantic mode needs an index
  (FTS5 on Node / D1 FTS) — optional, Phase 4.
- **API:** `GET /api/messages?q=` (shipped) → `POST /api/ai/search` (semantic).
- **Inspiration:** Shortwave / Canary NL search.
- **MailKite fit:** Degrades gracefully to keyword when AI is off.

### 4.9 AI summary
- **What:** One‑to‑three line summary of a message/thread, shown in the Assistant panel.
- **Behavior:** Generated on open; cached; regenerates when the thread grows.
- **Data:** cache on `messages.summary TEXT NULL` (or `thread_summaries` table).
- **API:** `POST /api/ai/summary {threadId|messageId}`.
- **Inspiration:** Apple Intelligence, Gemini, Shortwave.
- **MailKite fit:** Gated like sending — invisible until an AI provider is set.

### 4.10 Smart replies
- **What:** 2–3 tappable suggested replies + a "Draft full reply…" affordance.
- **Behavior:** Chips prefill the composer; "in my voice" can fine‑tune on sent mail.
- **Data:** none persisted (generated on demand).
- **API:** `POST /api/ai/smart-replies {messageId}` → `{replies: string[]}`.
- **Inspiration:** Gmail, Apple, Spark.
- **MailKite fit:** Feeds the existing `Compose.tsx` / `POST /api/send`.

### 4.11 Extracted to‑dos
- **What:** Action items pulled from a thread, shown as checkboxes in the Assistant.
- **Behavior:** Press `T` (or auto on open) to extract; checking one can later sync out.
- **Data:** new table `todos(id, user_id, message_id, text, done, created_at)`.
- **API:** `POST /api/ai/todos {messageId}`, `GET/PATCH /api/todos`.
- **Inspiration:** Shortwave AI todos.
- **MailKite fit:** Self‑contained; no external task system required for v1.

### 4.12 Assistant panel + "Organize my inbox"
- **What:** A persistent right‑column chat with full thread/account context, plus a
  one‑click bulk‑triage suggestion ("Archive 23 low‑priority · draft 3 replies").
- **Behavior:** Chat can summarize, search, check a (future) calendar, and propose
  bulk actions for review — nothing applies without confirmation.
- **Data:** ephemeral conversation; bulk actions reuse triage endpoints.
- **API:** `POST /api/ai/assistant {message, context}`, `POST /api/ai/organize` →
  returns a *proposed* action list the UI confirms.
- **Inspiration:** Shortwave assistant; Missive AI Rules; Canary Copilot.
- **MailKite fit:** Provider‑pluggable; "review before apply" matches the product's
  trust posture.

### 4.13 Already shipped (keep)
- **Trust chips** SPF/DKIM/DMARC — in schema + `MessageView.tsx`.
- **Flags** unread / starred / archived — `MailRepo.updateFlags`.
- **Send‑as identities** — `GET /api/identities`, `POST /api/send`.
- **Theme switch** light/dark — `ThemeProvider`.
- **ACL scoping** — every list/mutate already passes through `Actor`.

---

## 5. Consolidated data‑model changes

New migrations, additive over `0004_acl.sql` (mirror in
`packages/core/src/server/schema.ts` — `apps/web/test/migration-drift.test.ts`
enforces parity):

```sql
-- 0005_triage.sql
ALTER TABLE messages ADD COLUMN snooze_until    INTEGER;          -- NULL = not snoozed
ALTER TABLE messages ADD COLUMN reply_later      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN reply_later_pos  INTEGER;
ALTER TABLE messages ADD COLUMN set_aside        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN set_aside_pos    INTEGER;
ALTER TABLE messages ADD COLUMN category         TEXT;            -- priority|feed|receipts
CREATE INDEX IF NOT EXISTS idx_messages_snooze ON messages (snooze_until);
CREATE INDEX IF NOT EXISTS idx_messages_box    ON messages (category, received_at DESC);

-- 0006_views_screener_todos.sql
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  filter_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS screened_senders (
  from_addr TEXT PRIMARY KEY, decision TEXT NOT NULL DEFAULT 'pending', decided_at INTEGER);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, message_id TEXT NOT NULL,
  text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS thread_summaries (
  thread_id TEXT PRIMARY KEY, summary TEXT NOT NULL, model TEXT, updated_at INTEGER NOT NULL);
```

> Same files apply to **both** Node SQLite and Workers D1 (per `install.md` §11).

---

## 6. Consolidated API surface

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/api/messages` | extend | add `box`, `view`, `reply_later`, `set_aside`; exclude future‑snoozed |
| GET | `/api/messages/:id` | shipped | — |
| PATCH | `/api/messages/:id` | extend | accept `snooze_until`, `reply_later`, `set_aside` |
| GET/POST/PATCH/DELETE | `/api/views` | new | per‑user saved Views |
| GET | `/api/screener` | new | pending senders |
| POST | `/api/screener/:addr` | new | `{decision}` |
| GET/PATCH | `/api/todos` | new | list/toggle |
| POST | `/api/ai/summary` | new | gated on provider |
| POST | `/api/ai/smart-replies` | new | gated |
| POST | `/api/ai/todos` | new | gated |
| POST | `/api/ai/search` | new | semantic; falls back to `q` |
| POST | `/api/ai/assistant` | new | chat |
| POST | `/api/ai/organize` | new | returns proposed actions |

All new routes follow the existing pattern in `apps/web/src/app.ts`
(`requireAuth` + `actorOf(c)` for scoping). AI routes resolve a provider via
`resolve('AI_PROVIDER', …)` and 503 when unset (mirrors the `sending` gate).

---

## 7. Phased implementation plan

Ordered by dependency. Each phase is independently shippable and demoable against
the mockup tab **☼ E**. Effort: **S** ≈ 1–2 days, **M** ≈ 3–5, **L** ≈ 1–2 weeks.

### Phase 0 — Design system & shell  · **M** · no backend
- Add light **Focus** + dark tokens to `packages/ui/src/theme` (extend `presets.ts`).
- Build the three‑column `AppShell` (header · left rail · list · Assistant), responsive
  collapse below `lg`. Static/placeholder data is fine.
- Keyboard‑nav scaffold: `useHotkeys` with `J/K` select, `E` archive (wired to the
  existing flag call), `?` help overlay.
- **Touches:** `packages/ui/src/screens/{AppShell,MailApp,InboxList,MessageView}.tsx`,
  new `components/{CommandPalette,KeyHint,TriageBar}.tsx`.
- **Done when:** the app renders the E layout, theme toggle works, J/K/E function,
  and it matches `ui-explorations.html#e` visually.

### Phase 1 — Triage core  · **M** · depends on 0
- Migration `0005_triage.sql` + `schema.ts` parity; extend `MailRepo.updateFlags`
  and `listMessages` (snooze/reply‑later/set‑aside filters + due‑snooze sweep).
- Extend `PATCH /api/messages/:id`; add the bottom **Reply Later / Set Aside** stacks
  and "Focus & Reply" mode; per‑card `L/S/H` actions; optimistic updates.
- **Done when:** a message can be snoozed (and returns when due), sent to Reply Later
  (appears in the stack, cycled by Focus & Reply), and Set Aside — all keyboard‑driven.

### Phase 2 — Organization: Boxes · Views · Bundles · Screener  · **L** · depends on 1
- Ingest categorization → `messages.category` (heuristics in `ingestWebhookMessage`);
  Boxes filter on it.
- `views` table + `/api/views` CRUD + left‑rail Views with seeded defaults.
- Client‑side Bundles grouping for the Feed box.
- `screened_senders` + `/api/screener` + banner; gate behind a setting.
- **Done when:** mail auto‑sorts into Priority/Feed/Receipts, users can save/reorder
  Views, newsletters collapse into a bundle, and new senders can be screened.

### Phase 3 — Command palette & full keyboard  · **S–M** · depends on 0
- `<CommandPalette/>` (⌘K) with an action registry + fuzzy filter; route actions to
  existing endpoints; context‑aware entries (snooze presets, move‑to‑View, summarize).
- Complete the shortcut map + `?` cheatsheet.
- **Done when:** every triage/navigation action is reachable from ⌘K and by key.

### Phase 4 — AI layer  · **L** · depends on 1–2
- Provider abstraction `packages/core/src/server/ai.ts` (`AI_PROVIDER`, key, optional
  on‑device/local). Privacy note: default off; "on‑device" is the headline option to
  match the product's posture.
- Endpoints: `summary`, `smart-replies`, `todos`, `search`, `assistant`, `organize`
  (all gated, 503 when unset). Cache summaries (`thread_summaries`); `todos` table.
- Assistant panel UI: summary card, smart‑reply chips → composer, to‑do checkboxes,
  chat, and "Organize my inbox" (propose → confirm → apply via triage endpoints).
- Optional: FTS index for semantic search.
- **Done when:** with a provider configured, opening a thread shows a summary +
  smart replies + to‑dos, the assistant answers questions, and Organize proposes a
  reviewable bulk action; with no provider, the UI hides AI cleanly.

### Phase 5 — Polish, mobile & a11y  · **M** · depends on all
- Density modes (compact/comfortable); mobile reflow (single column + swipe triage +
  bottom tab bar); PWA install (per `install.md` §10).
- A11y: focus rings, ARIA roles for list/dialog, contrast in both themes, full
  keyboard operability of the palette and stacks.
- Tests: extend `apps/web/test` (list filters, triage transitions, snooze sweep,
  screener gate) and `migration-drift`.
- **Done when:** Lighthouse a11y ≥ 95, works one‑handed on mobile, all new endpoints
  covered by `vitest`.

```
Phase 0 ─┬─ Phase 1 ── Phase 2 ──┐
         └─ Phase 3              ├─ Phase 5
                     Phase 4 ────┘
```

---

## 8. Decisions & open questions

- **AI provider.** Keep contracts provider‑agnostic behind `AI_PROVIDER`. Decide the
  default: a hosted model (simplest, best quality) vs. an on‑device/local model
  (matches Proton/Canary privacy framing shown in the mock's `on-device` badge).
  *Recommendation:* ship hosted‑first behind an explicit opt‑in, with a documented
  local‑model path — and never send mail content to any provider unless enabled.
- **Screener semantics.** Holding unknown senders changes delivery; make it opt‑in and
  reversible (held mail is stored, just hidden), never a hard drop.
- **Bundles persistence.** Start derived (no schema). Only add a `bundles` table if
  users need to rename/pin/mute them.
- **Categorization accuracy.** Heuristics first (headers + keyword lists); revisit an
  AI categorizer only if the rules misfile too often. Always store the raw signal.
- **Snooze without cron.** The on‑read sweep is enough for self‑host; Workers can add
  a scheduled trigger later if needed.

---

## 9. Current → target component map

| Today (`packages/ui/src/screens`) | Becomes |
|---|---|
| `AppShell.tsx` (rail + content) | 3‑column shell (header · Flow/Views rail · list · Assistant) |
| `InboxList.tsx` (flat list) | Triage card list + bundles + bottom stacks |
| `MessageView.tsx` (reading pane) | Thread + smart‑reply chips (summary moves to Assistant) |
| `Compose.tsx` | unchanged contract; receives smart‑reply / draft prefills |
| — | new `CommandPalette`, `AssistantPanel`, `TriageBar`, `Screener`, `ViewsRail` |

Reference implementation for all visuals: **`apps/web/public/ui-explorations.html`**
(tab **☼ E**) — it is the source of truth for spacing, color, and copy.
