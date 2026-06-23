# MailKite Mail — Phased Implementation Plan

> **One-liner:** The build order from empty repo to web, desktop, and mobile — **web-first**,
> because every shell wraps the same React SPA and talks to the same server-side Hono backend, so
> the SPA + backend must exist before Tauri can wrap anything. Each phase is a **vertical slice**
> that ends in something runnable.

This is the sequencing doc. *What* we're building and *why* live in the companion docs —
[`features.md`](features.md) (tiers), [`stack.md`](stack.md), [`architecture.md`](architecture.md),
[`data-model.md`](data-model.md), [`platforms.md`](platforms.md), [`repo-structure.md`](repo-structure.md).

## 1. Principles

- **Vertical slices, not layers.** Each phase ends with something you can run and see, not a
  half-finished abstraction. The first real milestone is *a webhook lands and you can read it*.
- **Web before shells.** Tauri desktop/mobile are thin wrappers around the SPA pointed at a backend
  URL. There is nothing to wrap until the web app works — so Phases 0–5 are web/backend, and the
  shells (7–8) come after. The **PWA (6)** is free once the SPA exists.
- **Node target first, Workers second.** Local Node + SQLite is the fastest dev loop; the Cloudflare
  Workers + D1 target is the same code behind the storage adapter, hardened in Phase 5.
- **Keep V1 small.** Phases 1–4 deliver the `features.md` **V1** tier and nothing more.

## 2. Phases at a glance

Status — `✅ done` (built & tested) · `🚧 in progress` · `⬜ not started` (as of 2026-06-23).

| # | Phase | Status | Track | Delivers | Depends on |
|---|---|---|---|---|---|
| 0 | Scaffold & foundations | ✅ | web | Workspaces monorepo that builds & runs empty | — |
| 1 | Ingest slice | ✅ | backend | A real webhook lands in the own store | 0 |
| 2 | Read UI | 🚧 | web | Browse/read real mail in the browser | 1 |
| 3 | Compose & reply | ✅ (backend) | web | Reply that threads correctly | 2 |
| 4 | Organize & search | 🚧 | web | The full V1 inbox (labels, search, shortcuts) | 3 |
| 4.5 | Admin & Setup dashboard | ✅ (backend) | web+backend | Roles (admin/user), admin-only Settings/Setup, config surfacing | 3 |
| 5 | Workers target + deploy | ✅ | backend | Hosted on Workers + D1 + R2 (live on workers.dev) | 1–4 |
| 6 | PWA | ⬜ | web | Installable app, push notifications | 2 (4 ideal) |
| 7 | Desktop (Tauri 2) | ⬜ | desktop | Signed macOS/Windows/Linux installers | 4 |
| 8 | Mobile (Tauri 2) | ⬜ | mobile | iOS + Android test-track builds | 4, 7 |
| 9 | Hardening & OSS launch | ⬜ | all | Self-host story, CI releases, public launch | 5–8 |

> **Backend ahead of UI:** the Phase 3/4.5 server routes (`/api/send`, auth, admin config) are built
> and covered by tests in `apps/web/test` and `packages/core/test`; the matching SPA screens are the
> remaining 🚧 work. The whole API surface is documented in [`auth.md`](auth.md) and
> [`admin-dashboard.md`](admin-dashboard.md).

**Critical path:** 0 → 1 → 2 → 3 → 4 → 4.5, then 5/6/7 can run in parallel, 8 after 7. (User **roles** and the **admin-only** Settings/Setup dashboard land in 4.5 — see [`admin-dashboard.md`](admin-dashboard.md).)

## 3. Phase detail

### Phase 0 — Scaffold & foundations
**Goal:** an empty but real workspaces monorepo that builds, lints, and runs.
- pnpm workspaces + Turborepo (`pnpm-workspace.yaml`, `turbo.json`, root scripts) per [`repo-structure.md`](repo-structure.md).
- Skeletons: `packages/core`, `packages/ui`, `apps/web`, `apps/desktop`, `apps/mobile`.
- Shared TS config, ESLint/Prettier, Vitest, CI (typecheck + build + test).
- `packages/ui`: Tailwind CSS 4 inline `@theme` with brand tokens lifted from the website, shadcn/ui (new-york) initialized, the design-token block.
- `apps/web`: a Hono app serving a near-empty Vite/React SPA (dev via Node).
- **Exit:** `pnpm dev` serves a blank styled SPA at `localhost`; `turbo build` is green in CI.

### Phase 1 — Ingest slice (the heart)
**Goal:** a real MailKite webhook is verified, stored, and visible in the DB.
- `apps/web` Hono `POST /webhook`: verify `x-mailkite-signature` (HMAC-SHA256, timestamp tolerance, constant-time compare), then normalize the `email.received` payload.
- `packages/core` (`@mailkite/core/server`): the `SqlDriver` / `BlobStore` / `MailRepo` adapter interfaces + the **SQLite** driver (Node); schema from [`data-model.md`](data-model.md) (`messages`, `threads`, `attachments`, `ingest_log`, …) + migrations.
- **Idempotent ingest** (dedupe via `ingest_log`); **fetch-and-rehost attachments** at ingest (fs `BlobStore` on Node).
- **Exit:** point a MailKite route's webhook at the local `/webhook` (cloudflared tunnel) → send a real email → the message + attachments persist; replay is a no-op.

### Phase 2 — Read UI (web)
**Goal:** browse, thread, and read real mail in the browser.
- `packages/ui`: app shell (sidebar + list + reading pane), inbox list, conversation/thread view, message reader.
- **Safe HTML rendering:** sanitize, proxy remote images, link handling, CSP — the security work from [`architecture.md`](architecture.md).
- `apps/web` local `/api/*`: list messages, get thread/message, serve rehosted attachments.
- Auth: HMAC-signed session cookie (`SESSION_SECRET`), login screen — the as-built model is in [`auth.md`](auth.md). TanStack Router + Query wired.
- **Exit:** log in and read real, correctly-threaded mail with working attachments.

### Phase 3 — Compose & reply
**Goal:** send a reply that threads correctly at the recipient.
- Compose UI (rich + plaintext), reply / reply-all / forward, quoting, identities, drafts.
- `apps/web` `POST /api/send` → proxies to MailKite **`/v1/send`** with `inReplyTo` (RFC-5322 `In-Reply-To`/`References`).
- **Exit:** reply to a stored message → it arrives and threads in the original client.

### Phase 4 — Organize & search (V1 complete)
**Goal:** the full `features.md` **V1** inbox.
- Read/unread, archive, trash, star/pin, **labels** (local constructs), full-text **search** over the own store, keyboard shortcuts, derived contacts.
- **Exit:** every V1-tier feature works; V2/Later explicitly deferred.

### Phase 4.5 — Admin & Setup dashboard
**Goal:** any self-hoster can configure the app, and only an admin can.
- **Roles:** `users.role` ∈ {`admin`, `user`}. The `admin` sees Settings/Setup; a `user` only gets mail. Single-operator installs have one admin.
- **Admin gate:** `requireAdmin` middleware on `/api/admin/*` and the dashboard route; non-admins get 403. Bootstrapped by `ADMIN_PASSWORD` env, or a **first-run setup wizard** that creates the admin (hashed in the store).
- **Config surfacing:** admin Settings shows each item's status — ✅ from env / ✅ saved / ⚠️ missing (secrets masked) — with inputs to save the non-platform ones.
- **Env-first resolution:** `env var → saved DB setting → unset`; unset → the feature **disables** via the capability gate. Same on Workers and VPS.
- **Auth:** PBKDF2 passwords + HMAC-signed session cookies + `requireAuth`/`requireAdmin` — see [`auth.md`](auth.md).
- See [`admin-dashboard.md`](admin-dashboard.md).
- **Exit:** a fresh deploy walks an admin through setup; missing keys disable their features and are visible in Settings.

### Phase 5 — Workers target + deploy
**Goal:** the same app live on `mailn.app`, server-side on Cloudflare.
- ✅ Second storage impl behind the adapter: **D1** `SqlDriver` (`D1Driver`) + **R2** `BlobStore` (`R2BlobStore`), via `@mailkite/core/server/workers`. MailRepo unchanged — providers swap behind the ports.
- ✅ `apps/web` on Workers: `assets` binding (SPA) + `worker.ts` fetch handler (owns `/api/*` + `/webhook`); `wrangler.jsonc`; D1 migrations in `apps/web/migrations/` (drift-tested against `SCHEMA_SQL`).
- ✅ **Deployed:** D1 + R2 provisioned, migrations applied, `SESSION_SECRET` set, live at `https://mailkite-mail.worker-sendhub.workers.dev` — see [`deploy.md`](deploy.md). Health/config/SPA/auth-gate all verified. Remaining: set `MAILKITE_API_KEY`/`_WEBHOOK_SECRET` (via Settings or `wrangler secret put`) and point a MailKite route's webhook at `/webhook`.
- **Exit:** ✅ hosted inbox works end-to-end on Workers, identical behavior to Node.

### Phase 6 — PWA
**Goal:** installable app + notifications, no app store.
- Web app manifest, service worker (offline read cache — *not* authoritative), install prompt.
- **Web Push** (backend notifies the device on new mail).
- **Exit:** installs as a PWA on desktop + mobile; push arrives.

### Phase 7 — Desktop (Tauri 2)
**Goal:** signed desktop apps wrapping the SPA.
- `apps/desktop`: Tauri 2 loading the built SPA, pointed at a configurable backend URL (`mailn.app` or self-host).
- Native: OS notifications, deep links (`mailkite://thread/:id`), secure token storage (Keychain/credential store), dock/taskbar badge counts.
- Build + code-sign + package macOS / Windows / Linux.
- **Exit:** installable signed desktop builds; native notifications + deep links work.

### Phase 8 — Mobile (Tauri 2 — iOS + Android)
**Goal:** mobile apps from the same SPA.
- `apps/mobile`: Tauri 2 mobile; Xcode/Android Studio prereqs; mobile webview parity check.
- Native: push (APNs/FCM), deep links, secure storage, share-sheet for attachments.
- **Exit:** TestFlight (iOS) + Play internal-testing (Android) builds installable on devices.

### Phase 9 — Hardening & OSS launch
**Goal:** ready to hand to self-hosters and the public.
- The [`install.md`](install.md) flows (npx / Docker / Workers), config validation, error handling, observability, rate limits, attachment size caps, backup/restore.
- `CONTRIBUTING.md`, issue/PR templates, CI release pipeline (web deploy, desktop installers, mobile bundles per [`repo-structure.md`](repo-structure.md)).
- **Exit:** public OSS launch — a stranger can self-host from the README in minutes.

## 4. Sequencing & parallelism

> **Decision (2026-06):** ship a **web vertical slice first** (Phases 0–4 → V1), then fan out to
> Workers/PWA/desktop in parallel, with mobile last. Rationale: the Tauri shells are thin wrappers
> around the SPA + backend, so they have nothing to wrap until the web app is real — front-loading
> desktop/mobile would mean building shells around a moving target.

- **Serial core:** 0 → 1 → 2 → 3 → 4.
- **Then parallel:** 5 (Workers/deploy), 6 (PWA), 7 (desktop) can proceed independently once 4 lands.
- **Mobile (8)** follows desktop (7) — it reuses the Tauri config, signing, and native-capability
  wiring established for desktop.
- **9** is continuous polish that closes out for launch.

## 5. Suggested first move

Start **Phase 0 + the Phase 1 slice** together: stand up the workspaces skeleton, then immediately
build `POST /webhook` + the SQLite `MailRepo` so a real email lands in the store. That single slice
de-risks the whole architecture (signature verify, idempotency, payload mapping, attachment rehost)
before any UI is built.
