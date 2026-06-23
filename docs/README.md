# MailKite Mail — Docs

> **One-liner:** Design docs for **MailKite Mail** — the open-source, webhook-driven webmail client (standalone repo `mailkite/mail`, package `@mailkite/mail`, hosted at [mailn.app](https://mailn.app)) that ingests mail from MailKite's webhook into its **own** SQLite/D1 store and sends replies through MailKite's `/v1/send`, never touching MailKite's internal database. It is a pnpm + Turborepo workspaces monorepo shipping one React UI across web, desktop, and mobile — see [`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md).

MailKite Mail is the human-facing inbox for webhook email: browse, search, thread, and reply to mail
that arrives as `email.received` payloads — no IMAP, no POP, no mail server. It is one [Hono](https://hono.dev)
app with a dual target (Cloudflare Workers assets + D1, **and** Node via `@hono/node-server` + SQLite),
mirroring the [`dashboard/`](../../docs/architecture/dashboard.md) stack (React + Vite + TanStack Router +
shadcn/ui + Tailwind 4). It is the OSS magnet at the top of the [MailKite](../../README.md) funnel.

Start with [`00-overview.md`](00-overview.md), then read in the order below.

## Docs

| Doc | What's inside |
|---|---|
| [00-overview.md](00-overview.md) | **Start here** — what MailKite Mail is, the elevator pitch, audience tiers, goals, explicit non-goals (no IMAP/POP/SMTP-receive), the two-seam boundary, and the OSS → hosted `mailn.app` funnel. |
| [features.md](features.md) | The product surface — the three things free from the webhook (`threadId`, `auth.*`, spam), design principles, the V1/V2/Later feature inventory, per-shell native-capability availability, the cc/bcc/headers gap, and the deliberate "what we don't build" list. |
| [stack.md](stack.md) | The technical stack — the pnpm + Turborepo workspaces monorepo, React/Vite/TanStack/shadcn/Tailwind 4 frontend with lifted brand tokens, the Hono backend routes, the dual Workers (`assets` + D1) / Node (`@hono/node-server` + SQLite) target, and copy-pasteable `wrangler.jsonc` + `package.json`. |
| [architecture.md](architecture.md) | The runtime shape — the thin-client model (what lives where), the end-to-end flow, the HMAC-verified `POST /webhook` receiver (raw-body + ms-timestamp gotchas, idempotent dedupe), reading/threading, the `/api/send` → `/v1/send` reply path, untrusted-HTML safety, attachment rehosting, and the app-API auth model. |
| [auth.md](auth.md) | **Auth & sessions (as built)** — PBKDF2 passwords, HMAC-signed `mk_session` cookies (not Bearer JWT), the `requireAuth`/`requireAdmin` middlewares, every auth endpoint, first-admin bootstrap, and `SESSION_SECRET` resolution. Supersedes the JWT language elsewhere. |
| [data-model.md](data-model.md) | The own-store persistence layer (server-side) — the portable SQLite/D1 schema (every `CREATE TABLE`), the `SqlDriver`/`BlobStore`/`MailRepo` adapter seam in `@mailkite/core/server`, the migration approach, idempotent ingest, and the webhook-field → local-column mapping. |
| [platforms.md](platforms.md) | One React SPA, many thin shells — the four targets (web/PWA/desktop/mobile), why Tauri 2 (vs Electron and Capacitor), how each native capability is wired through the `PlatformAdapter`, the installable PWA + Web Push baseline, and the app-store + signing realities. |
| [repo-structure.md](repo-structure.md) | The workspaces monorepo map — the full directory tree, package boundaries (apps → `ui` → `core`), the client/server `exports` split, the pnpm + Turborepo tooling (`pnpm-workspace.yaml`/`.npmrc`/`turbo.json`), per-app config seams, and the 4-artifact build/release/CI matrix. |
| [install.md](install.md) | The OSS self-host guide — Node/Docker/Workers quickstarts, the two required MailKite secrets (API key + `whsec_*`), env-var config, webhook wiring (prod proxy + dev tunnels), persistence/backup, the Tauri desktop/mobile + PWA shells, and upgrading. |
| [implementation.md](implementation.md) | **The build plan** — 11 phases from empty repo to web + desktop + mobile, web-first (shells wrap the SPA), each a runnable vertical slice; phase table, per-phase goals/exit-criteria, the sequencing/parallelism decision, and the suggested first move. |
| [admin-dashboard.md](admin-dashboard.md) | **Admin & Setup dashboard** — user roles (admin/user), the admin-only Settings/Setup UI, env-first config resolution with a DB-saved fallback, capability gating (features disable when their key is missing), and Workers/VPS parity. |

## Related platform docs

| Doc | What's inside |
|---|---|
| [../../docs/architecture/00-overview.md](../../docs/architecture/00-overview.md) | The MailKite platform master doc — the apps, data flow, and deployment topology. |
| [../../docs/architecture/webhook-signatures.md](../../docs/architecture/webhook-signatures.md) | The `x-mailkite-signature` HMAC scheme the webhook receiver verifies. |
| [../../docs/architecture/outbound-email.md](../../docs/architecture/outbound-email.md) | The `/v1/send` reply path and RFC5322 threading via `inReplyTo`. |
| [../../docs/architecture/attachments-r2.md](../../docs/architecture/attachments-r2.md) | The signed 7-day attachment URLs the client rehosts at ingest. |
| [../../docs/plan/05-webmail-oss-and-whitelabel.md](../../docs/plan/05-webmail-oss-and-whitelabel.md) | The OSS-wedge + white-label strategy (superseded in part by these docs). |
| [../../docs/research/01-market-research.md](../../docs/research/01-market-research.md) | The open-source webmail gap that motivates the product. |
