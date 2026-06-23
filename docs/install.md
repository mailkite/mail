# Install MailKite Mail (self-host)

> **One-liner:** Stand up your own MailKite Mail in one command (Node + SQLite) or one container (Docker) — it needs only a MailKite API key and a webhook secret.

MailKite Mail is the open-source webmail client for the MailKite platform. It is one
Hono app with a **dual target**: it runs on Node.js (`@hono/node-server` + SQLite) for
self-hosting, and on Cloudflare Workers (assets binding + D1) for the hosted build at
[mailn.app](https://mailn.app). The same `src/index.ts` serves the React/Vite SPA **and**
mounts the API routes — including the `/webhook` receiver. See [`stack.md`](stack.md) for
why the dual target exists.

Mail flows in **only** through MailKite's webhook and flows out **only** through MailKite's
`/v1/send`. There is no IMAP, POP, or direct SMTP-receive, and this app never touches
MailKite's internal database. That is the entire portability story: a self-hoster needs a
MailKite **API key** + a per-account **webhook signing secret** and nothing else.

> **Decision (2026-06): SQLite/D1, no external DB.** MailKite Mail keeps its own store,
> populated by the incoming webhook. On Node that store is a single SQLite file; on Workers
> it is one D1 database. There is deliberately **no external Postgres/ClickHouse/Redis**.
> Backup = copy one file (or `wrangler d1 export`). This is what makes an install trivial to
> move and the OSS quickstart genuinely "one command, no services."

> **TODO:** The `./webmail` app and the `@mailkite/mail` / `create-mailkite-mail` packages
> and the `ghcr.io/mailkite/mail` image do not exist yet. Commands below are the target UX;
> replace placeholders as the repo lands.

---

## 1. Prerequisites

Pick one install path. Each has its own prerequisites; the **All paths** row applies to every one.

| Path | Needs |
|---|---|
| **Node (self-host)** | Node.js **≥ 20** (LTS; 22 recommended) and npm (or pnpm). SQLite is embedded via `better-sqlite3` / `@libsql/client` — **no separate database server**. A reverse proxy/TLS terminator (Caddy or nginx) in front, or run behind a tunnel. |
| **Docker** | Docker + Docker Compose. Node is baked into the image — nothing else to install. |
| **Cloudflare Workers** | A Cloudflare account, `wrangler` **≥ 4**, and a D1 database. Deploy with `npm run deploy`. |
| **All paths** | A **MailKite account** → an **API key** + a per-account **webhook signing secret** (`whsec_*`), both from the MailKite dashboard. A **publicly reachable HTTPS URL** for the `/webhook` receiver (prod: a real domain; dev: a tunnel — see §5). |

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

### From source (git clone)

```bash
git clone https://github.com/mailkite/mail.git    # TODO: confirm repo URL
cd mail/webmail
cp .env.example .env                               # edit secrets (§4)
npm install
npm run db:migrate
npm run dev                                         # dev
# production:
npm run build                                       # vite build of the SPA
npm start                                           # node server via @hono/node-server
```

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
| `MAILKITE_API_KEY` | **yes** | — | Authenticates to MailKite for outbound `/v1/send` and for reading stored mail. |
| `MAILKITE_WEBHOOK_SECRET` | **yes** | — | The `whsec_*` secret; verifies `x-mailkite-signature` on `/webhook`. |
| `APP_URL` | **yes** | — | Public base URL of this install, e.g. `https://mail.acme.com`. Used for links and as the base of the webhook URL you give MailKite. **Must match** the webhook URL configured in MailKite (see §5). |
| `SESSION_SECRET` | **yes** | — | Signs this app's own session/JWT (the auth on `GET /api/messages`). Generate: `openssl rand -base64 32`. |
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

> **Gotcha — Workers cannot use a file DB.** `better-sqlite3` is a native module and does not
> run on Workers. The Workers target uses **D1**; the Node target uses **SQLite**. Same query
> layer, different binding — never set `DATABASE_URL` to a file path on Workers.

> **Treat the volume/file as primary state.** Losing it loses your local mirror. Mail is only
> recoverable if MailKite re-delivers, which is not guaranteed — so back it up (and back it up
> *before* upgrading, see §8).

---

## 7. Deploy targets

### Node / VPS

```bash
npm run build              # build the SPA
APP_URL=https://mail.acme.com \
SESSION_SECRET=… MAILKITE_API_KEY=… MAILKITE_WEBHOOK_SECRET=… \
npm start                  # @hono/node-server on $PORT (default 8787)
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
npm run build                                          # build the SPA into ./dist
wrangler d1 migrations apply mailkite_mail --remote    # apply schema to D1
npm run deploy                                         # wrangler deploy
```

Secrets via `wrangler secret put` (§4); D1 + assets via `wrangler.jsonc`. This is the build
that powers the hosted [mailn.app](https://mailn.app) instance.

---

## 8. Upgrading

> **Always back up the DB before upgrading** (§6). Migrations are additive/idempotent, but
> read the release notes first.

| Target | Steps |
|---|---|
| **Node / source** | `git pull` (or bump `@mailkite/mail`) → `npm install` → `npm run db:migrate` → restart. |
| **Docker** | `docker compose pull && docker compose up -d` — the entrypoint auto-runs migrations on boot. Pin tags and read release notes for breaking migrations. |
| **Workers** | `npm run build` → `npm run deploy` → `wrangler d1 migrations apply mailkite_mail --remote`. |

Migrations live in `migrations/` as numbered SQL files in the same wrangler/D1 style as the
API repo (e.g. `0011_*.sql`), so the **same files** apply on both Node SQLite and D1.

> **TODO:** Link the GitHub releases / `CHANGELOG.md` here once the repo is public.

---

## See also

- [`stack.md`](stack.md) — the dual Node/Workers Hono target and SPA serving.
- [`../../docs/architecture/webhook-signatures.md`](../../docs/architecture/webhook-signatures.md) — the `x-mailkite-signature` scheme.
- [`../../docs/architecture/outbound-email.md`](../../docs/architecture/outbound-email.md) — the `/v1/send` reply path.
- [`../../docs/architecture/attachments-r2.md`](../../docs/architecture/attachments-r2.md) — signed 7-day attachment URLs.
- [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) — OSS strategy + licensing (MIT core).
