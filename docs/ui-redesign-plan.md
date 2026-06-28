# MailKite Mail — Unified Light: Phased Build Plan

> **How to read this:** the *what* and *why* live in [`ui-redesign.md`](./ui-redesign.md)
> (the feature spec) and the clickable mockup at
> [`apps/web/public/ui-explorations.html`](../apps/web/public/ui-explorations.html)
> — open it and select the **☼ E · Unified · Light** tab (`…#e`). **This** document
> is the *how and in what order* — a build plan that aligns the redesign's features
> with what the repo and docs actually ship today, structured **mock-first**.

---

## 1. Strategy — mock first, then implement

The work runs in **two tracks**, in order:

1. **Mock track (M0–M5)** — build the *entire* Unified Light UI as static React in
   the Focus light theme, wired only to placeholder data. No migrations, no new API.
   Goal: **see and click the whole UI** against tab **E**, get sign-off, de-risk
   layout/copy/spacing before any backend exists.
2. **Implement track (I1–I6)** — replace placeholder data with real data and add the
   backend (migrations, repo, routes, AI) **one feature area at a time**, each one
   "lighting up" mocks that already exist.

```
Mock track  M0 ─ M1 ─ M2 ─ M3 ─ M4 ─ M5   ──►  [sign-off gate]
                                                   │
Impl track                          I1 ─ I2 ─ I3 ─┤
                                         └─ I4     ├─ I6
                                    I5 (after I2/I3)┘
```

Every mock phase is independently viewable. Every implement phase is independently
shippable. The mock track is pure `packages/ui` work; the implement track adds
`packages/core` + `apps/web` per phase.

---

## 2. Current state (grounded — what exists today)

**UI** (`packages/ui/src/`): a **two-pane** mail client.
- `screens/AppShell.tsx` — header (logo · search · theme toggle · avatar) + left nav
  rail (`w-48`: Compose, Inbox/Starred/Archive folders, Teams/Settings) + `{children}`.
- `screens/MailApp.tsx` — orchestrator; renders `grid-cols-[340px_1fr]` =
  `InboxList` + `MessageView`; owns `messages/selected/folder/query` state.
- `screens/InboxList.tsx` (flat list) · `screens/MessageView.tsx` (reading pane,
  sanitized HTML + SPF/DKIM/DMARC chips) · `screens/Compose.tsx` (modal).
- **Theme**: pure CSS-variable system in `theme/global.css` (`--color-bg/panel/border/
  text/muted/accent`), flipped by `data-theme` on `<html>`; `ThemeProvider` **defaults
  to dark**. Tailwind v4, classes reference `var(--color-*)` inline.
- **Reusable**: `Avatar` (hashed-hue fallback), `Logo`, `Button` (primary/ghost),
  `auth-ui`, `cn()`, `sanitizeEmailHtml()`.
- **API client** `lib/api.ts`: `listMessages({folder,q})`, `getMessage(id)`,
  `updateFlags(id,{unread,starred,archived})`, `send(...)`, `identities()`, plus auth/
  admin/teams. `Folder = 'inbox'|'starred'|'archive'`.

**Data** (`packages/core/src/server/schema.ts`, migrations `apps/web/migrations/`):
- Latest migration: **`0004_acl.sql`** → new triage migrations start at **0005**.
- `messages` columns today: `id, thread_id, direction, from_addr, to_addr, subject,
  text_body, html_body, spf, dkim, dmarc, spam, unread, starred, archived,
  received_at, address_id`. **No** `snooze_until / reply_later / set_aside / category`.
- `apps/web/test/migration-drift.test.ts` **enforces** that migrations and `schema.ts`
  stay in lockstep — any new migration must be mirrored in `schema.ts`.

**API** (`apps/web/src/app.ts`): `GET /api/messages?folder&q`, `GET /api/messages/:id`,
`PATCH /api/messages/:id {unread,starred,archived}`, `POST /api/send`. Everything is
**ACL-scoped** through `Actor`/`actorOf(c)` — new per-user features must scope the same way.

> ⚠️ **Known drift:** `docs/data-model.md` describes a *richer* schema than `schema.ts`
> actually implements. Author the new migrations against the **real** 0004 schema above
> (not the doc), keep `migration-drift` green, and reconcile `data-model.md` in **I6**.

---

## 3. Feature ↔ docs alignment

What the redesign asks for, vs. what the docs already promise and the code already has.
"Tier" is the existing `features.md` tier; "Doc status" is where it lives today.

| Redesign feature | Doc status | Code today | New schema | New API | Mock | Impl |
|---|---|---|---|---|---|---|
| 3-column shell + light theme | Documented `features.md:45,126`, `theming.md` | 2-pane, dark default | — | — | M0 | I1 |
| Triage: **Archive** | Documented `features.md:84` | ✅ `archived` flag | — | ✅ PATCH | M2 | I1 |
| Triage: **Snooze** | Documented (V2) `features.md:50` | ❌ | `snooze_until` | PATCH ext | M2 | I2 |
| Triage: **Reply Later** | Documented (V2) `features.md:55` | ❌ | `reply_later(_pos)` | PATCH ext | M2 | I2 |
| Triage: **Set Aside** | Documented (V2) `features.md:55` | ❌ | `set_aside(_pos)` | PATCH ext | M2 | I2 |
| **Boxes** (Priority/Feed/Receipts) | **Not in docs** | ❌ | `category` + ingest | `?box=` | M1 | I3 |
| **Views** (saved slices) | Mentioned (Later) `features.md:90` | ❌ | `views` table | `/api/views` | M1 | I3 |
| **Bundles** | **Not in docs** | ❌ | none (derived) | reuse list | M1/M2 | I3 |
| **Screener** | Mentioned (Later) `features.md:54` | ❌ | `screened_senders` | `/api/screener` | M1 | I3 |
| **Command palette ⌘K** + keys | Documented (V2) `features.md:138-142` | ❌ | — | — | M4 | I4 |
| **NL / semantic search** | FTS only `features.md:118-119`; semantic **not in docs** | keyword via `q` | FTS index (opt) | `/api/ai/search` | M0 hdr | I5 |
| **AI summary** | Mentioned (Later) `features.md:77` | ❌ | `thread_summaries` | `/api/ai/summary` | M3 | I5 |
| **Smart replies** | Mentioned (Later) `features.md:77` | ❌ | none | `/api/ai/smart-replies` | M3 | I5 |
| **Extracted to-dos** | **Not in docs** | ❌ | `todos` table | `/api/ai/todos`,`/api/todos` | M3 | I5 |
| **Assistant panel + Organize** | **Not in docs** | ❌ | ephemeral | `/api/ai/assistant`,`/organize` | M3/M5 | I5 |
| Trust chips, send-as, theme switch, ACL | Documented + shipped | ✅ | — | — | reuse | keep |

**Docs that must change** (folded into the phases that touch them; final sweep in I6):
`features.md` (promote Snooze/Reply-Later/Set-Aside/Screener/Views out of "Later"; add
Boxes, Bundles, Assistant, to-dos, semantic search) · `data-model.md` (new tables +
columns; fix the schema↔doc drift) · `architecture.md` (triage state-transition/auto-clear
semantics) · `acl.md` (scope rules for views/screener/todos/AI) · `stack.md` +
`implementation.md` (new routes + phase sequencing) · `admin-dashboard.md` (Screener/AI gates).

---

## 4. Mock track — build the UI (no backend)

All in `packages/ui`. Static fixture data lives in one `screens/unified/_fixtures.ts`.
Mount the new layout behind a flag (`?ui=unified` or a dev-only route) so the shipping
two-pane app is untouched until **I1**. **Source of truth for every pixel: tab `#e`.**

### M0 · Foundations — tokens + shell skeleton · *S*
- Vendor artifacts (✅ done: `docs/ui-redesign.md`, `public/ui-explorations.html`).
- Add the **Focus light** palette to `theme/global.css`: app surface `#f7f8fa`, card
  `#fff`, border `slate-200`, text `slate-900`, muted `slate-500`, **accent `indigo-600`**,
  triage warmth `amber-400`, positive `emerald-500`; radius `xl` cards / `lg` controls.
  Add as token set alongside existing vars (don't break current dark/light).
- Build `screens/unified/MailLayout.tsx`: the header (mail glyph · "Ask anything"
  search · ⌘K hint · avatar) + `grid-cols-[236px_minmax(0,1fr)_322px]` with three
  independently-scrollable empty regions.
- **Done:** the three calm columns + header render in light theme; matches `#e` frame.

### M1 · Left rail · *S–M*
Components: `LeftRail.tsx` → `RailScreener`, `RailNav` (Boxes + Bundles + Views), `OrganizeCard`.
- Screener banner ("2 new senders want in" · Let in / Screen out).
- **Boxes**: 📥 Priority (amber count badge, active) · 📰 The Feed · 🧾 Receipts.
- **Bundles**: ✉️ Newsletters · 🔔 Notifications.
- **Views**: ⚡ Action required (active/indigo) · ⏳ Awaiting reply · 👥 From people · `+ New view…`.
- **Organize card**: "✦ Organize my inbox — Archive 23 · draft 3 replies".
- **Done:** clicking a Box/View highlights it (local state); rail matches `#e` column 1.

### M2 · Center triage list · *M*
Components: `TriageList.tsx` → `TriageCard`, `BundleCard`, `TriageBar`.
- List header: box title + subtitle + `J K move · E archive` keyhints.
- **Selected card**: avatar, name + time, subject, indigo AI-hint line, action row
  `↩ Reply later (L) · 📎 Set aside (S) · 🗓 Snooze (H) · ✦ Reply`.
- **Compact cards**: VIP badge, hover-reveal quick actions (↩ Later / 📎 Aside).
- **Bundle card**: emerald glyph, "Newsletters · 9 new, bundled", sender preview, Open / Mark read.
- **TriageBar** (footer): Reply Later face stack · Set Aside count · "Inbox Zero in 3" ·
  `Focus & Reply →`.
- Local interaction only: `J/K` move selection, `E` removes a card from the list.
- **Done:** column 2 matches `#e`; keyboard nav feels right against fixtures.

### M3 · Assistant panel · *M*
Components: `AssistantPanel.tsx` → `SummaryCard`, `TodoList`, `SmartReplies`, `AssistantChat`.
- Header: "✦ Assistant" + `on-device` badge.
- **Summary** card (per selected sender) · **Extracted to-dos** (checkboxes toggle locally)
  · **Smart replies** (tappable chips) · one **chat** exchange bubble · Ask/instruct input.
- **Done:** column 3 matches `#e`; selecting a card swaps the summary (from fixtures).

### M4 · Command palette + keyboard help · *S*
Components: `CommandPalette.tsx` (⌘K), `KeyHelp.tsx` (`?`), `lib/useHotkeys.ts` (scaffold).
- ⌘K overlay: fuzzy-filter a **static** action registry ("Snooze until tomorrow 9am",
  "Move to View…", "Summarize thread", "Archive") + falls through to search box.
- `?` cheatsheet overlay listing the shortcut map.
- Actions are no-ops/local in the mock.
- **Done:** ⌘K and `?` open/close and filter; visually matches the product's intent.

### M5 · Responsive, states & Organize review · *M*
- Mobile reflow: single column + bottom tab bar (Boxes/List/Assistant) below `lg`.
- Empty / loading / inbox-zero states for each column.
- **Organize review modal**: the proposed-action list ("Archive 23 · draft 3 replies")
  with per-row confirm — the *review-before-apply* surface (static).
- **Done:** the full Unified Light experience is clickable on desktop + mobile.

> **🚦 Sign-off gate** — after M5 the whole UI is demoable against `#e`. Review copy,
> spacing, density, and information architecture **here**, before backend work begins.

---

## 5. Implement track — light up the mocks (backend + wiring)

### I1 · Shell cutover + light default · *M* · depends on M-track
- Promote `unified/MailLayout` to the real path: replace `MailApp`'s
  `grid-cols-[340px_1fr]` (InboxList+MessageView) with the 3-column layout; retire the
  `w-48` folder rail in `AppShell` (folders move into Boxes/Views later).
- Default the mail surface to **light** (`ThemeProvider` default or per-surface override);
  keep the dark twin (tab D palette) behind the existing toggle.
- Wire **center list to real data** (`api.listMessages`), selection → `getMessage` +
  mark-read, `E`/star → `updateFlags`, `J/K` real. Rail/Assistant stay on fixtures where
  no backend exists yet.
- **Done:** the real inbox renders in Unified Light; shipped flags work by key + button;
  visually matches `#e`.

### I2 · Triage core · *M* · depends on I1
- **Migration `0005_triage.sql`** (mirror in `schema.ts`; keep `migration-drift` green):
  `snooze_until INTEGER`, `reply_later INTEGER DEFAULT 0`, `reply_later_pos INTEGER`,
  `set_aside INTEGER DEFAULT 0`, `set_aside_pos INTEGER`, `category TEXT`;
  `idx_messages_snooze`, `idx_messages_box(category, received_at DESC)`.
- `MailRepo.updateFlags` + `listMessages`: snooze/reply-later/set-aside filters,
  exclude future-snoozed, **due-snooze sweep on list load** (no cron). Extend
  `PATCH /api/messages/:id` + `api.ts` to accept the new flags.
- Wire `L/S/H`, real **Reply Later / Set Aside** stacks, **Focus & Reply** cycling, optimistic UI.
- **Done:** snooze returns when due; reply-later/set-aside persist and populate the
  TriageBar stacks; all keyboard-driven.

### I3 · Organization: Boxes · Views · Bundles · Screener · *L* · depends on I2
- **Boxes**: deterministic categorization at ingest in `MailRepo.ingestWebhookMessage`
  (`List-Unsubscribe`/bulk → feed; receipt keywords/known senders → receipts; else
  priority) → `messages.category`; store raw signal; list accepts `?box=`.
- **Views**: **migration `0006_views_screener_todos.sql`** (`views`, `screened_senders`,
  `todos`, `thread_summaries`); `GET/POST/PATCH/DELETE /api/views` (ACL-scoped via
  `Actor`); seed defaults (Action required / Awaiting reply / From people); rail Views
  become real + reorderable.
- **Bundles**: client-side grouping of the Feed box by sender-domain (no schema).
- **Screener**: `/api/screener` (pending) + `POST /api/screener/:addr {decision}`;
  banner real; **off by default**, gated behind a setting (delivery-semantics change).
- **Done:** mail auto-sorts into Priority/Feed/Receipts; Views save/reorder; newsletters
  collapse into a bundle; new senders can be let in / screened out.

### I4 · Command palette wired · *S–M* · depends on I1 (+I2 for triage actions)
- Action registry → real endpoints; context-aware entries (snooze presets, move-to-View,
  summarize). Complete the shortcut map + `?` cheatsheet.
- **Done:** every triage/navigation action is reachable from ⌘K and by key.

### I5 · AI layer · *L* · depends on I2–I3
- Provider abstraction `packages/core/src/server/ai.ts` (`AI_PROVIDER`, key, on-device
  path); **default off**; routes **503 when unset** (mirrors the sending gate).
- Routes (all gated): `/api/ai/{summary,smart-replies,todos,search,assistant,organize}`
  + `GET/PATCH /api/todos`. Cache summaries in `thread_summaries`; persist `todos`.
- Wire Assistant cards to real endpoints; **Organize** = propose → confirm → apply via
  the I2/I3 triage endpoints. Optional FTS index for semantic search (falls back to `q`).
- **Done:** with a provider, a thread shows summary + smart replies + to-dos, the
  assistant answers, and Organize proposes a reviewable bulk action; with no provider the
  AI surfaces hide cleanly.

### I6 · Polish, a11y, mobile, tests & docs · *M* · depends on all
- Density modes; mobile swipe-triage + bottom tab bar; PWA (`install.md §10`).
- A11y: focus rings, ARIA roles (list/dialog), contrast both themes, full keyboard
  operability of palette + stacks (target Lighthouse a11y ≥ 95).
- Tests: list filters, triage transitions, snooze sweep, screener gate, `migration-drift`.
- **Docs sweep**: update the files listed in §3 and reconcile the `data-model.md` ↔
  `schema.ts` drift.
- **Done:** works one-handed on mobile; all new endpoints covered by `vitest`; docs match code.

---

## 6. Consolidated data-model & API deltas

Authored against the **real 0004** schema. Same SQL applies to Node SQLite and D1.

```sql
-- 0005_triage.sql
ALTER TABLE messages ADD COLUMN snooze_until    INTEGER;
ALTER TABLE messages ADD COLUMN reply_later     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN reply_later_pos INTEGER;
ALTER TABLE messages ADD COLUMN set_aside       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN set_aside_pos   INTEGER;
ALTER TABLE messages ADD COLUMN category        TEXT;            -- priority|feed|receipts
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
> Mirror **both** files in `schema.ts` (the `migration-drift` test fails otherwise).
> ACL: `views`/`todos` are user-scoped; `screened_senders` decisions filter the list —
> route everything through `Actor` like the shipped endpoints.

| Method | Path | Status | Phase |
|---|---|---|---|
| GET | `/api/messages` | extend (`box`,`view`,`reply_later`,`set_aside`; exclude future-snoozed) | I2/I3 |
| PATCH | `/api/messages/:id` | extend (`snooze_until`,`reply_later`,`set_aside`) | I2 |
| GET/POST/PATCH/DELETE | `/api/views` | new | I3 |
| GET · POST | `/api/screener` · `/api/screener/:addr` | new | I3 |
| GET/PATCH | `/api/todos` | new | I5 |
| POST | `/api/ai/{summary,smart-replies,todos,search,assistant,organize}` | new (gated, 503 when unset) | I5 |

---

## 7. Decisions & open questions

Carried from the spec — none block the **mock track**; resolve before the phase noted.

- **AI provider default** (before I5): hosted vs on-device. *Rec:* hosted-first behind an
  explicit opt-in, with a documented local path; never send mail content unless enabled.
- **Screener semantics** (before I3): opt-in, reversible, never a hard drop (held mail is
  stored, just hidden).
- **Bundles persistence** (I3): start derived; add a `bundles` table only if users need to
  rename/pin/mute.
- **Light as global default vs mail-only** (I1): flip `ThemeProvider` default, or scope
  light to the mail surface and leave other surfaces as-is?
- **Folder rail removal** (I1): Inbox/Starred/Archive become Boxes/Views — confirm the
  mapping (Starred → a seeded View? Archive → a Box filter?).

---

## 8. New components map (Mock track)

| New file (`packages/ui/src/screens/unified/`) | Phase | Replaces / relates to |
|---|---|---|
| `MailLayout.tsx` + `_fixtures.ts` | M0 | `AppShell` + `MailApp` layout |
| `LeftRail.tsx` (`RailScreener`,`RailNav`,`OrganizeCard`) | M1 | old `w-48` folder rail |
| `TriageList.tsx`,`TriageCard.tsx`,`BundleCard.tsx`,`TriageBar.tsx` | M2 | `InboxList` |
| `AssistantPanel.tsx`,`SummaryCard.tsx`,`TodoList.tsx`,`SmartReplies.tsx`,`AssistantChat.tsx` | M3 | (new column) |
| `CommandPalette.tsx`,`KeyHelp.tsx`,`lib/useHotkeys.ts` | M4 | (new) |
| Organize review modal + responsive shell | M5 | (new) |

`MessageView` (thread + smart-reply chips) and `Compose` keep their contracts; the
summary moves into the Assistant panel. `Avatar`/`Logo`/`Button`/`cn`/`sanitize` are reused as-is.
