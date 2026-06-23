# Install MailKite Mail

> **One-liner:** Deploy the `apps/web` Hono server (Node + SQLite, Docker, or Cloudflare Workers + D1) — that one server receives the webhook and owns the store; the web, PWA, desktop, and mobile clients are all thin shells that point at it.

MailKite Mail is the open-source webmail client for the MailKite platform. Its heart is one
Hono app — **`apps/web`** — with a **dual target**: it runs on Node.js (`@hono/node-server`
+ SQLite) for self-hosting, and on Cloudflare Workers (assets binding + D1) for the hosted
build at [mailn.app](https://mailn.app). The same `apps/web/src/index.ts` serves the
React/Vite SPA **and** mounts the API routes — including the `/webhook` receiver. See
[`stack.md`](stack.md) for why the dual target exists.

Mail flows in **only** through MailKite's webhook and flows out **only** through MailKite's
`/v1/send`. There is no IMAP, POP, or direct SMTP-receive, and this app never touches
MailKite's internal database. That is the entire portability story: a self-hoster needs a
MailKite **API key** + a per-account **webhook signing secret** and nothing else.

> **Decision (2026-06): SQLite/D1, no external DB.** MailKite Mail keeps its own store,
> populated by the incoming webhook. On Node that store is a single SQLite file; on Workers
> it is one D1 database. There is deliberately **no external Postgres/ClickHouse/Redis**.
> Backup = copy one file (or `wrangler d1 export`). This is what makes an install trivial to
> move and the OSS quickstart genuinely "one command, no services."

> **Decision (2026-06): one server, many thin shells.** The webhook receiver + own store
> **cannot** live in a desktop or mobile app — a device has no public HTTPS URL for MailKite
> to POST `email.received` to, and must never hold an `mk_live_*` key. So **installing
> MailKite Mail = deploying the `apps/web` server** (this guide, §2–§8). The desktop (§9),
> mobile (§10), and PWA (§11) shells are thin clients: they bundle the same SPA and point its
> `/api/*` calls at a configured backend URL (`https://mailn.app` or your self-host
> `APP_URL`). They run no webhook receiver and own no store. Full architecture:
> [`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md).

> **TODO:** The `apps/web`, `apps/desktop`, `apps/mobile`, `packages/core`, `packages/ui`
> workspaces and the `@mailkite/mail` / `create-mailkite-mail` packages and the
> `ghcr.io/mailkite/mail` image do not exist yet. Commands below are the target UX; replace
> placeholders as the repo lands.

---

## 1. Workspaces & prerequisites

MailKite Mail is **one repo, internally a pnpm + Turborepo monorepo** (see
[`repo-structure.md`](repo-structure.md) for the full layout). You install dependencies once
at the root and let `turbo` fan out per package:

```bash
git clone https://github.com/mailkite/mail.git    # TODO: confirm repo URL
cd mail
pnpm install                                        # installs ALL workspaces from the root
pnpm turbo run build                                # build packages/* + apps/* in dep order
```

The workspaces:

| Workspace | What | Used by |
|---|---|---|
| `packages/core` | API client, types, webhook + own-store logic, storage adapter (D1/SQLite), `PlatformAdapter` interface | every app |
| `packages/ui` | React components, design tokens, screens (platform-blind) | every shell |
| `apps/web` | Vite SPA **+ the Hono backend** (the thing this guide deploys) | the server |
| `apps/desktop` | Tauri 2 shell → loads `@mailkite/ui` | §9 |
| `apps/mobile` | Tauri 2 shell (iOS/Android) → loads `@mailkite/ui` | §10 |

> **You usually only need `apps/web`.** Most self-hosters deploy the server and use the web
> SPA / PWA — they never touch the Tauri shells. Build just the server with
> `pnpm --filter @mailkite/web run build`.

Pick one **server** install path. Each has its own prerequisites; the **All paths** row
applies to every one.

| Path | Needs |
|---|---|
| **Node (self-host)** | Node.js **≥ 20** (LTS; 22 recommended), **pnpm ≥ 9** (the workspace manager). SQLite is embedded via `better-sqlite3` / `@libsql/client` — **no separate database server**. A reverse proxy/TLS terminator (Caddy or nginx) in front, or run behind a tunnel. |
| **Docker** | Docker + Docker Compose. Node is baked into the image — nothing else to install. |
| **Cloudflare Workers** | A Cloudflare account, `wrangler` **≥ 4**, and a D1 database. Deploy with `pnpm --filter @mailkite/web run deploy`. |
| **All paths** | A **MailKite account** → an **API key** + a per-account **webhook signing secret** (`whsec_*`), both from the MailKite dashboard. A **publicly reachable HTTPS URL** for the `/webhook` receiver (prod: a real domain; dev: a tunnel — see §5). |

The desktop and mobile shells have **their own** (heavier) toolchains — Rust + Tauri, plus
Xcode/Android Studio for mobile. Those prerequisites are listed in §9 and §10, not here,
because they are only needed if you build native shells.

Unlike Documenso/Cal.com/Plausible (which each require a separate Postgres or ClickHouse
server plus Docker), MailKite Mail's edge has **no external DB**, so the Node quickstart is a
single command with no background services.

---

## 2. Quickstart — Node (the headline path)

The fastest path is the scaffolder. It writes a fresh app, a `.env.example`, and the SQLite
migrations.

```bash
npm create @mailkite/mail@latest my-mail   # or: npx create-mailkite-mail my-mail
cd my-mail

cp .env.example .env                        # then edit — see §4
#   MAILKITE_API_KEY=mk_live_...
#   MAILKITE_WEBHOOK_SECRET=whsec_...
#   SESSION_SECRET=...        (openssl rand -base64 32)
#   APP_URL=http://localhost:8787

npm install
npm run db:migrate                          # creates ./data/mail.db + schema
npm run dev                                 # Hono + Vite on http://localhost:8787
```

`npm run dev` runs the Hono app on Node (`@hono/node-server`) and serves the Vite SPA from a
**single process on a single port**. There is no second dev server to manage.

For a one-shot setup (install + migrate + seed the first admin user), run:

```bash
npm run setup
```

### From source (workspaces monorepo)

```bash
git clone https://github.com/mailkite/mail.git    # TODO: confirm repo URL
cd mail
pnpm install                                        # workspaces monorepo (pnpm) — root install
cp apps/web/.env.example apps/web/.env             # edit secrets (§4)
pnpm --filter @mailkite/web run db:migrate
pnpm --filter @mailkite/web run start:dev          # dev (Node target)
# production:
pnpm --filter @mailkite/web run build              # vite build of the SPA
pnpm --filter @mailkite/web run start              # node server via @hono/node-server
```

> **`--filter @mailkite/web` is the server.** From the monorepo root, every server command is
> scoped to the `apps/web` workspace. `pnpm turbo run build` (no filter) builds the shared
> `packages/*` plus all apps in dependency order — use it before building a shell that depends
> on `@mailkite/ui`.

---

## 3. Quickstart — Docker

Because the store is a single SQLite file, the Compose file is a **single service** (contrast
with reference projects that need 2–4 services for Postgres/ClickHouse/object storage).

`docker-compose.yml`:

```yaml
services:
  mail:
    image: ghcr.io/mailkite/mail:v1        # pin a tag in prod, not :latest  (TODO: image)
    ports: ["8787:8787"]
    env_file: .env
    volumes:
      - mail-data:/app/data                # SQLite file persists here
    restart: unless-stopped
volumes:
  mail-data:
```

```bash
cp .env.example .env        # fill in secrets (§4)
docker compose up -d
docker compose logs -f mail
```

The container entrypoint runs `db:migrate` on boot, so the schema is created/updated
automatically. To run it by hand:

```bash
docker compose exec mail npm run db:migrate
```

No-Compose one-liner:

```bash
docker run -p 8787:8787 --env-file .env -v mail-data:/app/data ghcr.io/mailkite/mail:v1
```

> **Gotcha — native module / arch.** `better-sqlite3` is a native module and must be built
> for the image's target architecture. The published image handles this; if you build your
> own, build on the target arch (or set the store to `@libsql/client` to avoid native
> compilation). See §6.

---

## 4. Configuration

All configuration is environment variables (via `.env` on Node/Docker, or `wrangler secret` +
bindings on Workers). There is no config file to edit.

> **Decision (2026-06): config is env-only.** The **same variable names** are read from
> `process.env` on Node/Docker and from the `env` bindings/secrets object on Cloudflare
> Workers. One config surface, two runtimes — that is the seam that keeps the dual target
> honest.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `MAILKITE_API_KEY` | **yes** | — | Authenticates to MailKite for outbound `/v1/send` and for reading stored mail. **Server only** — never ship this to a shell. |
| `MAILKITE_WEBHOOK_SECRET` | **yes** | — | The `whsec_*` secret; verifies `x-mailkite-signature` on `/webhook`. **Server only.** |
| `APP_URL` | **yes** | — | Public base URL of this install, e.g. `https://mail.acme.com`. Used for links and as the base of the webhook URL you give MailKite. **Must match** the webhook URL configured in MailKite (see §5). This is the URL the shells point at. |
| `SESSION_SECRET` | **yes** | — | Signs this app's own session/JWT (the auth on `GET /api/messages`). Generate: `openssl rand -base64 32`. |
| `CORS_ORIGINS` | for native shells | — | Comma-separated allow-list of cross-origin client origins. Needed because the Tauri shells call `/api/*` cross-origin with the JWT (see §9). Include the five fixed Tauri origins (§9.3). |
| `DATABASE_URL` | no | `file:./data/mail.db` | Node SQLite location. Accepts a plain path or a libsql URL (`libsql://…`). **Unused on Workers** (D1 binding is used instead). |
| `PORT` | no | `8787` | Node listen port. |
| `WEBHOOK_TOLERANCE_MS` | no | `300000` | Replay window (5 min) passed to `verifyWebhook`. |
| `MAILKITE_API_BASE` | no | `https://api.mailkite.dev` | Override the MailKite API host (testing/staging). |
| `LOG_LEVEL` | no | `info` | `debug` \| `info` \| `warn` \| `error`. |

Generate the two secrets you must invent yourself:

```bash
openssl rand -base64 32     # SESSION_SECRET
```

`MAILKITE_API_KEY` and `MAILKITE_WEBHOOK_SECRET` come from the MailKite dashboard, not from
`openssl`.

### Client-side config (`VITE_BACKEND_URL`)

The SPA itself takes **one** build/runtime variable: which backend to talk to.

| Var | Where | Purpose |
|---|---|---|
| `VITE_BACKEND_URL` | baked at SPA build, or read at runtime from a Tauri `store` / first-run "Server URL" prompt | The base URL the SPA's `fetch('${VITE_BACKEND_URL}/api/...')` calls hit. Defaults to `https://mailn.app`; set to your `APP_URL` for self-host. |

> **Decision (2026-06): shells never hard-code mailn.app.** The desktop/mobile shells offer a
> first-run **Server URL** field so a self-hoster can point the app at their own `APP_URL`. No
> client ever embeds `MAILKITE_API_KEY` or `MAILKITE_WEBHOOK_SECRET` — those stay on the
> server. See [`repo-structure.md`](repo-structure.md) §5.

### Workers config

On Cloudflare Workers, secrets are **not** in `.env`. Set them with `wrangler` and bind D1 in
`wrangler.jsonc` (mirroring the API/dashboard configs in this monorepo):

```bash
wrangler secret put MAILKITE_API_KEY
wrangler secret put MAILKITE_WEBHOOK_SECRET
wrangler secret put SESSION_SECRET
# APP_URL can be a plain var in wrangler.jsonc; DATABASE_URL is omitted (D1 binding instead).
```

```jsonc
// wrangler.jsonc (excerpt) — TODO: confirm binding names when the app lands
{
  "d1_databases": [
    { "binding": "DB", "database_name": "mailkite_mail", "database_id": "<id>" }
  ],
  "assets": { "directory": "./dist", "not_found_handling": "single-page-application" },
  "vars": { "APP_URL": "https://mailn.app" }
}
```

---

## 5. Wiring the webhook

This is the load-bearing, MailKite-specific step. Mail only appears in the app after MailKite
is pointed at this install's `/webhook` route.

### Flow

1. This app exposes **`POST {APP_URL}/webhook`**. It **verifies the signature over the raw
   request bytes**, then upserts the message into its own store.
2. In the **MailKite dashboard** (or via the API), set the account's **webhook destination**
   to `https://<your-host>/webhook`, and copy its **signing secret** into
   `MAILKITE_WEBHOOK_SECRET`.
3. MailKite POSTs `email.received` events. The payload shape:

   ```json
   {
     "id": "msg_...",
     "type": "email.received",
     "from": { "address": "alice@example.com" },
     "to": [{ "address": "you@yourdomain.com" }],
     "subject": "Hello",
     "text": "…",
     "html": "<p>…</p>",
     "threadId": "msg_...",
     "auth": { "spf": "pass", "dkim": "pass", "dmarc": "pass", "spam": "0.1" },
     "attachments": [
       { "id": "<mid>:0", "filename": "a.pdf", "contentType": "application/pdf", "size": 1234, "url": "https://…/att/…" }
     ]
   }
   ```

4. The app stores the message; the SPA lists it via `GET /api/messages` and opens it via
   `GET /api/messages/:id`. Replies go out through MailKite `/v1/send` (see
   [`../../docs/architecture/outbound-email.md`](../../docs/architecture/outbound-email.md)).

### Verification

The `/webhook` route uses `MailKite.verifyWebhook(signature, rawBody, secret, toleranceMs)`
from the `mailkite` Node SDK. The header is
`x-mailkite-signature: t=<unix_ms>,v1=<hex_hmac_sha256>` and the signed string is
`HMAC-SHA256(secret, "<t>." + rawBody)`. Full scheme:
[`../../docs/architecture/webhook-signatures.md`](../../docs/architecture/webhook-signatures.md).

> **Gotcha — verify the raw bytes.** Recompute the HMAC over the **exact raw request body**,
> not over re-serialized JSON. `JSON.parse` + `JSON.stringify` reorders/reformats and the
> signature will never match. Read the raw body first, verify, *then* parse.

> **Why this can't live in a shell.** The `/webhook` receiver needs a public HTTPS URL and
> the `whsec_*` secret. A desktop/mobile app has neither — so the webhook always terminates at
> the `apps/web` server, and the shells read the already-stored mail over `/api/*`. This is the
> core thin-client constraint ([`platforms.md`](platforms.md) §1).

### Prod exposure

Point `/webhook` at a real public HTTPS URL: a reverse proxy (Caddy auto-TLS or nginx) →
the Node port, or a Workers route (TLS handled by Cloudflare). `APP_URL` must equal the
host MailKite calls, or deliveries 404 and links break.

### Local dev exposure (tunnel)

The webhook must reach your machine, so `localhost` needs a public tunnel during development.

| Tool | Command | Returns |
|---|---|---|
| cloudflared (quick tunnel, no account) | `cloudflared tunnel --url http://localhost:8787` | a random `https://*.trycloudflare.com` URL |
| ngrok | `ngrok http 8787` | a `https://*.ngrok-free.app` URL; inspect/replay requests at `http://127.0.0.1:4040` |

Set MailKite's webhook destination to `<tunnel-url>/webhook` and set `MAILKITE_WEBHOOK_SECRET`
to that account's secret.

> **Gotcha — tunnel URLs rotate.** Free `*.trycloudflare.com` / `*.ngrok-free.app` URLs
> change on every restart, so you must re-point MailKite each time. Use a **named cloudflared
> tunnel** or a **reserved ngrok domain** for a stable dev URL. ngrok's `:4040` inspector is
> the fastest way to debug signature failures — it lets you replay the exact raw body.

---

## 6. Persistence

| Target | Store | Backup |
|---|---|---|
| **Node** | One SQLite file (default `./data/mail.db`) for messages + attachment **metadata**; attachment **bytes** rehosted to `./data/blobs` (the `fs` blob store). | Copy `./data/` (DB file + blobs), or `sqlite3 mail.db ".backup backup.db"`; use [litestream](https://litestream.io) for continuous DB backup. |
| **Docker** | A named volume / host dir mounted at `/app/data` (the DB **and** the rehosted blobs). That volume is the entire durable state. | Back up the volume (`docker run --rm -v mail-data:/data -v "$PWD":/out alpine tar czf /out/mail-data.tgz /data`). |
| **Workers** | A D1 database for messages + metadata; attachment **bytes** rehosted to an **R2 bucket**. | `wrangler d1 export mailkite_mail --remote --output mail.sql`; R2 is independently durable. |

MailKite's `attachments[].url` are signed **7-day** URLs (`GET /att/:mid/:idx?exp=…&sig=…`, no auth
needed) and the bytes behind them are **deleted after 7 days**. So the locked decision is to
**fetch-and-rehost the bytes at ingest** into the app's own blob store (filesystem/SQLite on Node, R2
on Workers) — storing only the URL would let old mail lose its attachments after a week. Metadata
lives in the DB; bytes live in the blob store. See [`data-model.md`](data-model.md) §4.6 for the
schema and [`../../docs/architecture/attachments-r2.md`](../../docs/architecture/attachments-r2.md)
for the platform side.

> **The shells' on-device cache is NOT this store.** Tauri shells may keep an offline **read
> cache** (recent messages via `tauri-plugin-sql`) so the app opens offline — but that is a
> disposable mirror. The canonical own store always lives on the `apps/web` server. Back up
> the server, not the device.

> **Gotcha — Workers cannot use a file DB.** `better-sqlite3` is a native module and does not
> run on Workers. The Workers target uses **D1**; the Node target uses **SQLite**. Same query
> layer, different binding — never set `DATABASE_URL` to a file path on Workers.

> **Treat the volume/file as primary state.** Losing it loses your local mirror. Mail is only
> recoverable if MailKite re-delivers, which is not guaranteed — so back it up (and back it up
> *before* upgrading, see §8).

---

## 7. Deploy targets (server)

### Node / VPS

```bash
pnpm --filter @mailkite/web run build      # build the SPA
APP_URL=https://mail.acme.com \
SESSION_SECRET=… MAILKITE_API_KEY=… MAILKITE_WEBHOOK_SECRET=… \
pnpm --filter @mailkite/web run start      # @hono/node-server on $PORT (default 8787)
```

Run it under a process manager (systemd / pm2) behind Caddy or nginx for TLS. Example
minimal Caddyfile:

```
mail.acme.com {
    reverse_proxy 127.0.0.1:8787
}
```

### Docker

See §3. In production, **pin a tag** (`ghcr.io/mailkite/mail:v1`), mount the data volume,
and pass secrets via `--env-file`.

### Cloudflare Workers

```bash
pnpm --filter @mailkite/web run build                  # build the SPA into ./dist
wrangler d1 migrations apply mailkite_mail --remote    # apply schema to D1
pnpm --filter @mailkite/web run deploy                 # wrangler deploy
```

Secrets via `wrangler secret put` (§4); D1 + assets via `wrangler.jsonc`. This is the build
that powers the hosted [mailn.app](https://mailn.app) instance.

---

## 8. Desktop app (Tauri 2)

The desktop app is a **Tauri 2** shell (`apps/desktop`) that bundles the same SPA and points
it at a backend URL. It is a thin client — it does **not** receive webhooks or own a store.

> **Decision (2026-06): bundle the SPA, never a remote `frontendDist`.** Tauri *can* load a
> remote URL directly, but MailKite Mail bundles the SPA locally (so it works offline / on
> slow networks and so native plugin IPC stays available without weakening the security model
> with `dangerousRemoteDomainIpcAccess`). The bundled SPA reads `VITE_BACKEND_URL` and calls
> `/api/*` cross-origin with the JWT. See [`platforms.md`](platforms.md) §2.

### 8.1 Prerequisites

| Need | Install |
|---|---|
| Rust toolchain | `rustup` (stable) — Tauri's native side is Rust. |
| Tauri CLI | `pnpm add -D @tauri-apps/cli` (already a `apps/desktop` dev dep). Invoke via `pnpm --filter @mailkite/desktop tauri …`. |
| System webview | macOS: WKWebView (built in). Windows: WebView2 runtime. Linux: `webkit2gtk` + `libsoup` dev packages. |
| Icons | one 1024px PNG → `tauri icon ./icon.png` generates the full set. |

### 8.2 Dev

```bash
pnpm install                                       # root, once
pnpm --filter @mailkite/desktop tauri dev          # runs Vite + opens the native window (HMR)
```

`tauri dev` runs the app's `beforeDevCommand` (the Vite dev server for the `@mailkite/ui`
entry), waits for `devUrl`, then opens the desktop window with hot reload.

### 8.3 Build installers

```bash
pnpm --filter @mailkite/desktop tauri build        # installers for the HOST OS
```

| Platform | Artifacts | Signing |
|---|---|---|
| macOS | `.app`, `.dmg` | Apple Developer ID cert + **notarization**. Env: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`. |
| Windows | `.msi` (WiX), `.exe` (NSIS) | Authenticode (`bundle.windows.certificateThumbprint` or Azure Trusted Signing). EV cert avoids SmartScreen prompts. |
| Linux | `.deb`, `.rpm`, `.AppImage` | GPG optional (`SIGN=1` + key for AppImage). WebKitGTK is a runtime dep on the user's box. |

> **Gotcha — Tauri can't cross-compile desktop.** Build each OS on its own runner (a GitHub
> Actions matrix). The CORS allow-list on the server (`CORS_ORIGINS`, §4) **must** include the
> five fixed Tauri origins, which are NOT `localhost`:
> - macOS/Linux desktop: `tauri://localhost`
> - Windows desktop (WebView2): `https://tauri.localhost`
> - Android: `http://tauri.localhost`
> - iOS: `tauri://localhost`

In-app updates use `tauri-plugin-updater` (desktop only): `tauri signer generate` for keys,
set `plugins.updater.pubkey` + `endpoints`, serve a signed JSON manifest. Mobile updates ship
through the app stores instead.

> **TODO:** `apps/desktop` (Vite entry, `src-tauri/tauri.conf.json`, `Cargo.toml`,
> `capabilities/`) does not exist yet. See [`repo-structure.md`](repo-structure.md) §5 for the
> target layout and `PlatformAdapter` wiring.

---

## 9. Mobile app (Tauri 2 — iOS + Android)

The mobile app (`apps/mobile`) is the **same** Tauri 2 / SPA shell with `bundle.targets` set
to mobile. Tauri 2 added stable iOS + Android targets, so desktop and mobile share one
toolchain.

### 9.1 Prerequisites

**iOS** (macOS host only):

| Need | Install |
|---|---|
| Xcode (full app, not just CLI tools) | App Store; then `xcode-select` pointed at it. |
| CocoaPods | `brew install cocoapods`. |
| Rust targets | `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`. |
| Apple Developer account | $99/yr — required for device testing + App Store. |

**Android** (any OS):

| Need | Install |
|---|---|
| Android Studio | SDK Platform, Platform-Tools, **NDK**, Build-Tools, Command-line Tools (via SDK Manager). |
| Env vars | `JAVA_HOME` (Android Studio's bundled JBR), `ANDROID_HOME` (`~/Library/Android/sdk` on macOS), `NDK_HOME` (`$ANDROID_HOME/ndk/<version>`). |
| Rust targets | `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`. |

### 9.2 Dev

```bash
pnpm --filter @mailkite/mobile tauri ios init       # scaffolds src-tauri/gen/apple (one-time)
pnpm --filter @mailkite/mobile tauri android init   # scaffolds src-tauri/gen/android (one-time)

pnpm --filter @mailkite/mobile tauri ios dev        # simulator/device (HMR); --open for Xcode
pnpm --filter @mailkite/mobile tauri android dev     # emulator/device; --open for Android Studio
```

On a **physical device**, the dev server must be reachable on the LAN — use `--host` /
`--force-ip-prompt`.

### 9.3 Build store bundles

```bash
pnpm --filter @mailkite/mobile tauri ios build --export-method app-store-connect   # -> .ipa
pnpm --filter @mailkite/mobile tauri android build --aab                           # -> .aab (Play)
pnpm --filter @mailkite/mobile tauri android build --apk --split-per-abi           # sideload APKs
```

Signing happens in the native projects: iOS via Xcode (team id + provisioning profiles, or
`--apple-team-id`); Android via a keystore wired into `gen/android`'s Gradle signing config.

### 9.4 App-store realities

> **Decision (2026-06): bundle + native niceties to clear store review.** Apple has
> historically **rejected** "just a website in a webview" (Guideline 4.2 / minimum
> functionality). A thin remote-URL wrapper is at risk; a **bundled SPA with genuine native
> integration** — push notifications, deep links (`mailkite://thread/:id`), offline read cache,
> Keychain token storage, OS share — clears the bar. That is exactly the locked plan.

| Store | Requirement |
|---|---|
| **iOS App Store** | Bundled SPA + native integration (not a remote wrapper). Apple Developer account. Privacy disclosures for email content handling. |
| **Google Play** | `.aab` (App Bundle), recent `targetSdk`, privacy disclosures. Far more permissive about webview apps. |

> **Gotcha — push is backend-driven.** WKWebView has no service worker, so Tauri mobile uses
> **native APNs/FCM**, not Web Push. There is **no official Tauri push plugin yet** (community
> plugins only — pin one, expect manual native wiring). The device registers its APNs/FCM
> token via an `/api/*` route on first launch; the **webhook handler on the server** triggers
> the push when new mail arrives. Local `tauri-plugin-notification` renders the alert. See
> [`platforms.md`](platforms.md) §4.

> **TODO:** `apps/mobile` and its `src-tauri/gen/{apple,android}` projects do not exist yet.
> The repo will **commit** `gen/` (so push entitlements / native edits are reproducible) —
> see [`repo-structure.md`](repo-structure.md) §6.2.

---

## 10. Install the PWA (no app store)

The web SPA served by `apps/web` is an **installable PWA** — the free, no-store baseline for
desktop and mobile. No build step beyond deploying the server (§2–§7).

| Platform | How users install |
|---|---|
| Desktop Chrome/Edge | Install icon in the address bar, or menu → "Install MailKite Mail". |
| Android Chrome | "Add to Home screen" prompt / menu. Full Web Push support. |
| iOS/iPadOS Safari | Share sheet → **"Add to Home Screen"** (16.4+). |

> **Gotcha — iOS Web Push needs home-screen install.** On iOS, Web Push works **only** after
> the PWA is added to the Home Screen (Safari 16.4+) — not in the browser tab. This limitation
> is the documented reason the native Tauri mobile shell (§9, with APNs) exists. The PWA uses
> a service worker (`vite-plugin-pwa` `injectManifest`) for precache + Web Push + deep-link
> `notificationclick`; VAPID push is fired from the server's ingest seam. See
> [`platforms.md`](platforms.md) §5.

> **TODO:** the `vite-plugin-pwa` config, service worker, and VAPID wiring live in `apps/web`
> and are not implemented yet.

---

## 11. Upgrading

> **Always back up the DB before upgrading** (§6). Migrations are additive/idempotent, but
> read the release notes first.

| Target | Steps |
|---|---|
| **Node / source** | `git pull` (or bump `@mailkite/mail`) → `pnpm install` → `pnpm --filter @mailkite/web run db:migrate` → restart. |
| **Docker** | `docker compose pull && docker compose up -d` — the entrypoint auto-runs migrations on boot. Pin tags and read release notes for breaking migrations. |
| **Workers** | `pnpm --filter @mailkite/web run build` → `pnpm --filter @mailkite/web run deploy` → `wrangler d1 migrations apply mailkite_mail --remote`. |
| **Desktop shell** | In-app updater (`tauri-plugin-updater`) pulls the signed release; or reinstall the new installer. |
| **Mobile shell** | Through the App Store / Play Store (no in-app updater on mobile). |

Migrations live in `apps/web/migrations/` as numbered SQL files in the same wrangler/D1 style
as the API repo (e.g. `0011_*.sql`), so the **same files** apply on both Node SQLite and D1.

> **Shells follow the server's API, not its DB.** Upgrading the server can ship new `/api/*`
> behavior; shells are forward/backward compatible within a major version. A breaking API
> change is a coordinated release across `apps/web` + the shells.

> **TODO:** Link the GitHub releases / `CHANGELOG.md` here once the repo is public.

---

## See also

- [`platforms.md`](platforms.md) — the thin-client contract, the four targets, Tauri shells, and PWA.
- [`repo-structure.md`](repo-structure.md) — the workspaces monorepo layout, per-app config seams, and build/release/CI.
- [`stack.md`](stack.md) — the dual Node/Workers Hono target and SPA serving.
- [`architecture.md`](architecture.md) — request flow, the sandboxed mail iframe, and auth.
- [`../../docs/architecture/webhook-signatures.md`](../../docs/architecture/webhook-signatures.md) — the `x-mailkite-signature` scheme.
- [`../../docs/architecture/outbound-email.md`](../../docs/architecture/outbound-email.md) — the `/v1/send` reply path.
- [`../../docs/architecture/attachments-r2.md`](../../docs/architecture/attachments-r2.md) — signed 7-day attachment URLs.
- [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) — OSS strategy + licensing (MIT core).
