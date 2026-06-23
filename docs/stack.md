# Technical stack

> **One-liner:** MailKite Mail is one Hono app that serves a React/Vite SPA and its own API, runs on **both** Cloudflare Workers (assets binding + D1) and Node (`@hono/node-server` + SQLite), ingests mail via MailKite's webhook into its own store, and sends replies through MailKite's `/v1/send` — never touching MailKite's internal database.

This doc defines the runtime and build shape for `@mailkite/mail` (repo dir `./webmail`, hosted at
`mailn.app`). It mirrors the existing customer dashboard's frontend stack (see
[`../../docs/architecture/dashboard.md`](../../docs/architecture/dashboard.md)) and the API Worker's
Hono pattern (see [`../../docs/architecture/api.md`](../../docs/architecture/api.md)), then fuses them
into a single deployable that also boots on plain Node. It supersedes the assets-only SPA sketch in
[`05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) §4.

Companion docs: [`data-model.md`](data-model.md) (the D1/SQLite store + adapter) and
[`architecture.md`](architecture.md) (signature verification + ingest).

---

## 1. Architecture at a glance

The whole app is **one process**. A self-hoster runs it with a MailKite API key and a `whsec_*`
webhook secret — nothing else.

```
                                    ┌───────────────────────────────────────────┐
   Browser (SPA)                    │           MailKite Mail (one Hono app)     │
   TanStack Router  ───  GET /  ───▶│  static assets ──▶ React/Vite SPA (dist)   │
   shadcn/ui              fetch     │                                            │
        │            /api/messages ▶│  GET  /api/messages      ┐                 │
        │            /api/messages/:id  GET  /api/messages/:id ├─▶  MailRepo     │
        │            POST /api/send ▶│  POST /api/send  ────────┘   (own store)  │
        │                           │                              │      ▲      │
        ▼                           │                              ▼      │      │
   reply composed                   │                         ┌─────────────────┐│
                                    │                         │ D1 (Workers)    ││
   MailKite ──── webhook POST ─────▶│  POST /webhook ─────────│ SQLite (Node)   ││
   email.received  x-mailkite-      │   verify HMAC,          └─────────────────┘│
                   signature        │   ingestWebhookMessage                     │
                                    └───────────────────────────────────────────┘
                                            │ POST /v1/send (reply, JWT)
                                            ▼
                                    MailKite API (api.mailkite.dev) ──▶ outbound SMTP
```

Three data flows:

| Flow | Path | Direction | Store touched |
|---|---|---|---|
| **Read** | Browser → `/api/messages*` → `MailRepo` | inbound to UI | own store (read) |
| **Ingest** | MailKite → `POST /webhook` → `MailRepo` | inbound to store | own store (write) |
| **Reply** | Browser → `/api/send` → MailKite `/v1/send` | outbound | none (pure proxy) |

The webmail's store is the **only** mail database it reads. MailKite keeps its own copy in its D1
`messages` table, but the OSS portability story depends on the webmail never reaching into it. The
single contract between them is the webhook payload and the `/v1/send` API.

---

## 2. Frontend — mirror `dashboard/` exactly

The SPA is React 19 + Vite 8 + TanStack Router + TanStack Query + shadcn/ui (new-york) + Tailwind
CSS 4. Versions are lifted verbatim from `dashboard/package.json` so the two apps stay in lockstep.

| Concern | Package | Version |
|---|---|---|
| UI | `react`, `react-dom` | `^19.2.6` |
| Router | `@tanstack/react-router` | `^1.170.16` |
| Data | `@tanstack/react-query` | `^5.101.0` |
| Styling build | `@tailwindcss/vite`, `tailwindcss` | `^4.3.1` |
| shadcn primitives | `radix-ui` | `^1.6.0` |
| Variants / merge | `class-variance-authority` `^0.7.1`, `clsx` `^2.1.1`, `tailwind-merge` `^3.6.0` |
| Icons | `lucide-react` | `^1.21.0` |
| Toasts | `sonner` | `^2.0.7` |
| Animation (dev) | `tw-animate-css` | `^1.4.0` |
| Build | `vite` `^8.0.12`, `@vitejs/plugin-react` `^6.0.1` |
| TS | `typescript` | `~6.0.2` |
| CF tooling | `wrangler` | `^4.95.0` |

### 2.1 Tailwind 4 — no config file

Tailwind 4 has **no `tailwind.config.js`**. The `@tailwindcss/vite` plugin plus `@import "tailwindcss"`
in CSS does everything; the theme is an inline `@theme` block. shadcn's `components.json` reflects this
with an empty `tailwind.config` field. Copy these verbatim from `dashboard/`:

```jsonc
// components.json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/client/index.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "hooks": "@/hooks", "lib": "@/lib" }
}
```

### 2.2 Design tokens — lift verbatim from the marketing site

The brand tokens are framework-agnostic CSS vars. Lift the `@theme` + light override block straight
from `website/src/styles/global.css` (cited here so this doc is self-contained — do not re-derive the
hex values):

```css
/* src/client/index.css */
@import "tailwindcss";

@theme {
  /* Default (dark) — also the values used to generate the color utilities. */
  --color-bg: #0b0d12;
  --color-panel: #11141b;
  --color-border: #1e2430;
  --color-text: #e6e9ef;
  --color-muted: #8a93a6;
  --color-accent: #6ea8fe;
  --color-accent-2: #7c6cff;

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
    Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
    "Liberation Mono", monospace;
}

/* Light theme: override the same variables the utilities resolve at runtime. */
html[data-theme="light"] {
  --color-bg: #ffffff;
  --color-panel: #f6f8fc;
  --color-border: #e3e8f0;
  --color-text: #11141b;
  --color-muted: #5a6473;
  --color-accent: #2f6fe0;
  --color-accent-2: #6a4dff;
}
```

This yields the utility classes the components use directly: `bg-bg`, `bg-panel`, `text-text`,
`text-muted`, `text-accent`, `border-border`, plus brand helpers `.text-gradient`, `.gradient-ring`,
`.eyebrow`. Theme is selected with `data-theme` on `<html>`, set **pre-paint** in `index.html` and
toggled at runtime by a `lib/theme.tsx` — the exact same contract as the dashboard and marketing site.

> If you also pull shadcn components, mirror the `:root` / `html[data-theme="light"]` shadcn token
> remap from `dashboard/src/index.css` (e.g. `--background`, `--foreground`, `--primary`) — it maps the
> same hex palette onto shadcn's variable names. Keep both blocks: `--color-*` for brand utilities,
> shadcn vars for primitives.

### 2.3 Provider stack

Mirror `dashboard/src/main.tsx`: `QueryClientProvider` → `ThemeProvider` → `AuthProvider` → app, with
`<Toaster theme={theme} />` from `sonner`. The auth layer holds the JWT used for `/api/*` calls.

### 2.4 Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client' },          // separate from any Worker/server build artifacts
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  server: {
    port: 5175, strictPort: true,            // dashboard=5173, admin=5174, mail=5175
    proxy: { '/api': 'http://localhost:8787', '/webhook': 'http://localhost:8787' },
  },
})
```

`outDir: dist/client` is load-bearing: it is simultaneously the Workers `assets.directory` and the
Node `serveStatic` root. One build path, two consumers.

---

## 3. Backend — one Hono app, mounted routes

The server is `new Hono<{ Bindings: Env }>()` in `src/app.ts`, the same shape as `api/src/index.ts`
(`app.use('/api/*', cors())`, `app.onError`, `app.notFound`). Bindings (`DB`, `ASSETS`, secrets) arrive
on `c.env` under Workers and from `process.env` under Node — branched **once**, at store construction
(see §5).

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/webhook` | POST | HMAC sig | Receive `email.received` from MailKite, verify, ingest |
| `/api/messages` | GET | JWT | List stored messages, newest first |
| `/api/messages/:id` | GET | JWT | Full body, headers, deliveries, attachments |
| `/api/send` | POST | JWT | Proxy a reply to MailKite `/v1/send` |
| `/api/auth/*` | POST | — | Login / session (issues the JWT the SPA carries) |
| `/*` (everything else) | GET | — | Serve the SPA (`index.html` + assets) |

### 3.1 Webhook receiver — the raw-body gotcha

The signature is `x-mailkite-signature: t=<unix_ms>,v1=<hex_hmac_sha256>`, computed as
`HMAC-SHA256(webhook_secret, "<t>." + rawBody)` with a default 5-minute tolerance. **You must verify
against the raw request body, not re-serialized JSON.** Read it once with `c.req.text()` before any
JSON parsing, and reuse it:

```ts
import { MailKite } from 'mailkite'   // exposes verifyWebhook

app.post('/webhook', async (c) => {
  const raw = await c.req.text()                       // RAW body — required for HMAC
  const sig = c.req.header('x-mailkite-signature') ?? ''
  const secret = getEnv(c).WEBHOOK_SECRET              // whsec_*
  if (!MailKite.verifyWebhook(sig, raw, secret /*, toleranceMs */)) {
    return c.json({ error: 'bad signature' }, 401)
  }
  const payload = JSON.parse(raw)                       // { id, type:"email.received", from, to,
                                                        //   subject, text, html, threadId, auth,
                                                        //   attachments[] }
  await getRepo(c).ingestWebhookMessage(payload, accountId)
  return c.json({ ok: true })
})
```

> **Gotcha — the single most common webhook bug.** Any middleware that consumes or rewrites the body
> before this handler will break HMAC verification. Do not register a global body parser ahead of
> `/webhook`. Read text once, verify, then `JSON.parse` the same string.

### 3.2 Send proxy

`/api/send` validates the JWT, then forwards to MailKite `POST /v1/send` with the account's API key.
Set `inReplyTo` to the message-id being answered — MailKite auto-derives the RFC5322 `In-Reply-To` +
`References` headers for correct threading. Body fields:
`{ from, to, subject, html?, text?, replyTo?, cc?, bcc?, inReplyTo?, headers?, attachments? }`.
`/v1/send` returns `{ id, status }`. This route is a **pure proxy** — it never writes the local store;
the eventual delivery shows up later as an `email.received` webhook only if the account also receives
its own outbound, otherwise the SPA optimistically appends the sent message.

### 3.3 Attachments

Attachment URLs in the webhook payload are MailKite signed 7-day links
(`GET /att/:mid/:idx?exp=<s>&sig=<hex>`, no auth) and the bytes behind them are deleted after 7 days.
Store the metadata (id/filename/contentType/size) **and fetch-and-rehost the bytes at ingest** into
the app's own blob store (R2 on Workers / filesystem on Node) — relying on the signed URL would lose
old mail's attachments after a week. See [`data-model.md`](data-model.md) §4.6.

---

## 4. Worker target — combined `main` + `assets`

The dashboard is a **pure assets** Worker (no `main`, no server). The API is a **`main`-only** Hono
Worker (no assets). MailKite Mail is **both at once** in one config — first-class since Wrangler's
array-form `run_worker_first` (shipped 2025-06-17).

### 4.1 How routing resolves

- `assets.run_worker_first` accepts a boolean **or an array of glob patterns**. The array form is the
  right tool: `["/api/*", "/webhook/*"]` sends those paths to the Hono Worker **first**; everything
  else is served **straight from the asset store** — the Worker never runs, so static hits cost no
  Worker invocation and are fast.
- Unmatched non-API GETs (deep links like `/inbox/123`) fall to
  `not_found_handling: single-page-application`, which serves `index.html` so TanStack Router takes
  over.
- The array form **disables** the automatic `Sec-Fetch-Mode: navigate` SPA heuristic — giving an
  explicit, predictable split (API globs vs. everything-is-SPA), which is exactly what we want.
- Negative globs are supported (e.g. `"!/api/docs/*"` to carve out a subtree) — unused in v1, but
  available.
- With `run_worker_first` + `not_found_handling`, the Hono app does **not** need to call
  `env.ASSETS.fetch()` for the SPA fallthrough — the platform serves assets for unmatched routes
  automatically. `env.ASSETS.fetch(request)` remains an **escape hatch** if you ever want the Worker
  to serve an asset programmatically (e.g. inject CSP headers). Don't reach for it by default.

### 4.2 Worker entry

```ts
// src/worker.ts
import app from "./app";   // shared Hono app; routes mounted on /api/* and /webhook/*
export default app;        // Workers calls app.fetch with (request, env, ctx)
```

`nodejs_compat` is required because the `mailkite` SDK's HMAC crypto touches Node APIs — the API Worker
already sets it.

---

## 5. Dual runtime — what's shared, what differs

The same `src/app.ts` runs everywhere. Only the **entry adapter** and the **storage backend** differ,
and storage branches exactly once.

| Concern | Cloudflare Workers | Node self-host |
|---|---|---|
| Entry file | `src/worker.ts` (`export default app`) | `src/node.ts` (`serve({ fetch: app.fetch })`) |
| HTTP adapter | Workers runtime (native Fetch) | `@hono/node-server` `serve()` |
| Static SPA | `assets` binding + `not_found_handling` | `@hono/node-server/serve-static` + index.html fallback |
| Store | **D1** (`env.DB`, async, remote) | **SQLite** (`@libsql/client` or `better-sqlite3`, local) |
| Config / secrets | `c.env` (bindings) | `process.env` |
| Migrations | `wrangler d1 migrations apply` | `schema.sql` exec on boot |
| **Shared** | `src/app.ts`, all route handlers, `MailRepo` interface, the SPA, the design tokens |

### 5.1 Node entry

```ts
// src/node.ts
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import app from "./app";   // SAME Hono app as the Worker

const root = fileURLToPath(new URL("./dist/client", import.meta.url));

// Register AFTER /api/* and /webhook/* are mounted on `app`, or static would shadow the API.
app.use("/*", serveStatic({ root }));
app.get("/*", serveStatic({ path: `${root}/index.html` }));   // SPA fallback ≈ not_found_handling

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
```

Gotchas:

- Import paths are exact: `@hono/node-server` for `serve`, `@hono/node-server/serve-static` for
  `serveStatic`. **Do not** use `hono/cloudflare-workers`' `serveStatic` on Node.
- `serveStatic`'s `root` is relative to **cwd**, not the module. Resolve it with
  `fileURLToPath(new URL('./dist/client', import.meta.url))` so the install works wherever the process
  is launched.
- **Order matters:** mount `/api/*` and `/webhook/*` on `app` before the static + fallback catch-alls.
- The `serveStatic({ path: '.../index.html' })` fallback is how Node replicates the Worker's
  `not_found_handling: single-page-application`.

This works because `app.fetch(request, env)` is runtime-agnostic; `serve()` adapts Node's `http` to the
same Fetch API the Worker uses.

### 5.2 The storage seam (the portability point)

Define a `MailRepo` interface — `listThreads`, `getMessage`, `ingestWebhookMessage`, `setRead`, … —
over a pluggable `SqlDriver` (and a `BlobStore` for attachments), and have `app.ts` and every route
depend **only** on it. The full interface is defined in [`data-model.md`](data-model.md) §5. Construct
the concrete repo once per runtime:

- **Workers:** build from `c.env.DB` (D1). Query API: `env.DB.prepare(sql).bind(...).all()`.
- **Node:** build from a SQLite handle. Prefer `@libsql/client` for an **async** API that matches D1's
  shape, so the adapter interface is uniform (async everywhere); `better-sqlite3` works too but is
  synchronous.

Branch on runtime **only** at construction — never inside a route handler. Keep `schema.sql` portable
SQL (D1 is SQLite-compatible, so this is natural): D1 applies it via `migrations/`, Node `exec`s it on
boot. Detail lives in [`data-model.md`](data-model.md).

### 5.3 File layout

```
webmail/
  src/
    app.ts          # shared Hono app: mounts /api/* + /webhook/* — runtime-agnostic
    worker.ts       # Workers entry: export default app
    node.ts         # Node entry: serve() + serveStatic + SPA fallback
    db/
      index.ts      # createStore(env) -> picks D1 or SQLite adapter
      d1.ts         # D1 adapter (Workers)
      sqlite.ts     # libsql / better-sqlite3 adapter (Node)
      schema.sql    # portable schema; D1 via migrations/, SQLite via exec on boot
    client/         # the Vite React SPA (TanStack Router, shadcn, Tailwind 4)
  dist/client/      # Vite output: assets.directory (Workers) AND serveStatic root (Node)
  migrations/       # D1 migrations
  wrangler.jsonc
  vite.config.ts
  package.json
```

Wrangler only ever consumes `main: src/worker.ts`; the Node entry is invisible to it. `src/app.ts` is
the contract that guarantees both behave identically.

---

## 6. Copy-pasteable config

### 6.1 `wrangler.jsonc` (combined `main` + `assets`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mailkite-mail",
  "main": "src/worker.ts",
  "compatibility_date": "2025-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "routes": [{ "pattern": "mailn.app", "custom_domain": true }],
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/webhook/*"]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mailkite-mail",
      "database_id": "<id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

### 6.2 `package.json` scripts (both targets)

```jsonc
{
  "name": "@mailkite/mail",
  "type": "module",
  "scripts": {
    // --- shared SPA build ---
    "build:client": "tsc -b && vite build",            // -> dist/client

    // --- Cloudflare Workers target ---
    "dev": "wrangler dev",                             // Worker + assets locally (:8787)
    "dev:client": "vite",                              // SPA on :5175, proxying /api -> :8787
    "build": "npm run build:client",                   // wrangler bundles src/worker.ts on deploy
    "deploy": "npm run build:client && wrangler deploy",
    "db:migrate": "wrangler d1 migrations apply mailkite-mail --remote",
    "db:migrate:local": "wrangler d1 migrations apply mailkite-mail --local",

    // --- Node self-host target ---
    "start": "node ./src/node.ts",                     // serves dist/client + API on $PORT
    "start:dev": "tsx watch ./src/node.ts",
    "build:node": "npm run build:client",              // node runs TS via tsx/strip-types

    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  }
}
```

Two dev modes: **(a)** `npm run dev` (Worker target) + `npm run dev:client` (Vite HMR proxying to it),
mirroring the dashboard's setup; or **(b)** `npm run start:dev` for the Node target. For a clean
self-host binary you may `tsc` the server (`src/node.ts` + `src/app.ts` + `src/db/*`) to JS and ship
`node dist/server/node.js`; `tsx`/Node type-stripping is fine for v1.

Dependencies the webmail **adds** beyond the dashboard set: `hono ^4.9.0` (from `api/`),
`@hono/node-server` (Node entry), the `mailkite` SDK (for `verifyWebhook` + `/v1/send`), a SQLite
driver (`@libsql/client` preferred, or `better-sqlite3`), and optionally `postal-mime ^2.4.0` if you
ever parse stored raw MIME.

---

## 7. Why this shape

The dashboard has no backend of its own — it calls `api.mailkite.dev`, so pure static assets suffice.
MailKite Mail **is** its own backend: it must receive webhooks and serve signed data endpoints. Fusing
the Hono server and the SPA into one Worker (and one Node process) means a self-hoster runs a single
binary, and the same `app.fetch` powers both targets.

Trade-offs that drove the design:

- **Combined `main` + `assets` over assets-only:** the webmail needs co-located server routes; the
  dashboard does not. The cost is one Worker bundle to maintain; the win is one process to deploy.
- **`run_worker_first` array over default SPA detection:** explicit globs disable the
  `Sec-Fetch-Mode` heuristic, giving a predictable API-vs-SPA split. Static hits skip the Worker
  entirely — cheaper and faster.
- **D1 vs SQLite divergence:** D1 is async/remote, `better-sqlite3` is sync/local. Choosing
  `@libsql/client` keeps the adapter async on both runtimes so the `MailRepo` interface is uniform.
- **Raw-body HMAC:** verifying against `c.req.text()` (not re-serialized JSON) avoids the most common
  webhook failure.

> **Decision (2026-06): One Hono app, two entry points.** `src/worker.ts` (Cloudflare Workers, `main`
> + `assets` binding) and `src/node.ts` (`@hono/node-server` + `serveStatic`) both serve the **same**
> `src/app.ts`. Storage branches exactly once at construction: D1 on Workers, SQLite
> (libsql / better-sqlite3) on Node. A self-hoster needs only a MailKite API key + a `whsec_*` webhook
> secret — never MailKite's internal DB. This dual target **is** the OSS install story.

---

## See also

- [`data-model.md`](data-model.md) — the storage schema, `MailRepo`/`SqlDriver` interface, and D1/SQLite adapters
- [`architecture.md`](architecture.md) — signature verification + ingest pipeline
- [`../../docs/architecture/dashboard.md`](../../docs/architecture/dashboard.md) — the frontend stack being mirrored
- [`../../docs/architecture/api.md`](../../docs/architecture/api.md) — the Hono/Workers backend pattern
- [`../../docs/architecture/webhook-signatures.md`](../../docs/architecture/webhook-signatures.md) — the `x-mailkite-signature` scheme
- [`05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) — superseded plan stub (§4)
