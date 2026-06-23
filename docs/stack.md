# Technical stack

> **One-liner:** MailKite Mail is a pnpm + Turborepo **workspaces monorepo** that factors one React/Vite SPA into `packages/ui` (React) and `packages/core` (API client, types, store adapter, webhook logic), then ships it from `apps/web` — one Hono app that serves the SPA **and** its own API and runs on **both** Cloudflare Workers (assets + D1) and Node (`@hono/node-server` + SQLite) — while the **same** UI also boots as Tauri 2 desktop (`apps/desktop`) and mobile (`apps/mobile`) shells; it ingests mail via MailKite's webhook into its own store and sends replies through `/v1/send`, never touching MailKite's internal database.

This doc defines the **runtime, build, and repo shape** for `@mailkite/mail` (standalone repo
`mailkite/mail`, hosted at `mailn.app`). The shared UI is in `packages/ui` + `packages/core`; the
web/server runtime lives in `apps/web`; the desktop/mobile Tauri shells live in `apps/desktop` /
`apps/mobile`. This doc owns the **monorepo tooling** and the **`apps/web` web/server runtime** (the
backend every shell points at); the cross-platform thin-client pattern, PWA, and the Tauri shells'
*internals* (plugins, push, signing, CI) are covered in depth in
[`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md) — here they appear only
as "how the shell loads the SPA."

It mirrors the existing customer dashboard's frontend stack (see
[`../../docs/architecture/dashboard.md`](../../docs/architecture/dashboard.md)) and the API Worker's
Hono pattern (see [`../../docs/architecture/api.md`](../../docs/architecture/api.md)), then fuses them
into a single deployable that also boots on plain Node and is reused by the native shells. It
supersedes the assets-only SPA sketch in
[`05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) §4.

Companion docs: [`platforms.md`](platforms.md) (the shells around the SPA),
[`repo-structure.md`](repo-structure.md) (the workspaces layout + build matrix),
[`data-model.md`](data-model.md) (the D1/SQLite store + adapter), and
[`architecture.md`](architecture.md) (signature verification + ingest).

---

## 1. The monorepo at a glance

One repo (`mailkite/mail`), internally a **pnpm + Turborepo workspaces** monorepo. The single rule
that makes one codebase span web + desktop + mobile: **`packages/core` is framework-agnostic,
`packages/ui` owns all React, and the `apps/*` shells are thin** — they add only entry + native glue
and mount the shared `<MailApp/>`.

| Workspace | Package | What it is | Consumed by |
|---|---|---|---|
| `packages/core` | `@mailkite/core` | API client, wire types, webhook verify + payload normalize, store adapter (`MailRepo`/`SqlDriver`/`BlobStore`), `PlatformAdapter` interface. **No `react` dep.** | every package — UI imports the client surface; `apps/web` server imports the server surface |
| `packages/ui` | `@mailkite/ui` | The React SPA: `MailApp.tsx` root, TanStack Router routes, shadcn/ui (new-york), Tailwind 4 tokens, hooks. Platform-blind (talks to a `PlatformAdapter`). | all three apps |
| `apps/web` | `@mailkite/web` | **The backend.** One Hono app (`/api/*` + `/webhook` + SPA serve) on Workers **or** Node, plus the Vite SPA build + PWA. | deployed to mailn.app / self-host; the URL all shells point at |
| `apps/desktop` | `@mailkite/desktop` | Tauri 2 desktop shell (macOS/Windows/Linux) that bundles the SPA and points it at a configured backend URL. | end users; thin client |
| `apps/mobile` | `@mailkite/mobile` | Tauri 2 mobile shell (iOS + Android), same SPA, configured backend URL. | end users; thin client |

> **Why the backend can only live in `apps/web`.** `email.received` is an inbound HTTPS POST from
> MailKite that needs a stable public URL + the `whsec_*` secret to verify, and the own store must be
> continuously reachable to ingest. A desktop/mobile device has neither a public URL nor a safe place
> for `mk_live_*` — so the webhook receiver + store stay server-side and **all** shells are read/reply
> thin clients over `/api/*`. This is the load-bearing constraint behind the whole layout; see
> [`platforms.md`](platforms.md) §1.

### 1.1 Directory tree

```
mailkite-mail/                      # repo root (github: mailkite/mail)
  package.json                      # root scripts + devDeps (turbo, typescript, eslint)
  pnpm-workspace.yaml               # workspace globs
  turbo.json                        # task pipeline + caching
  tsconfig.base.json                # shared compiler options; each pkg extends it
  .npmrc                            # pnpm settings (node-linker=isolated)

  packages/
    core/                           # @mailkite/core — framework-agnostic (NO react)
      src/
        index.ts                    # client surface (types + API client + PlatformAdapter)
        client.ts                   # typed fetch wrapper over /api/* + /api/send
        types.ts                    # Message, Thread, Attachment, AuthVerdict, SendInput…
        platform.ts                 # PlatformAdapter interface (per-shell seam)
        server/index.ts             # server surface (webhook + store) — separate export
        webhook.ts                  # HMAC verify + payload→row normalize (server-only)
        store/
          repo.ts                   # makeMailRepo(driver, blobs) -> MailRepo
          d1.ts                     # D1 adapter (Workers)
          sqlite.ts                 # libsql / better-sqlite3 adapter (Node)
          schema.sql                # portable schema (see data-model.md)
      package.json                  # exports map enforces client/server split
      tsconfig.json

    ui/                             # @mailkite/ui — all the React, none of the platform
      src/
        MailApp.tsx                 # SPA root: TanStack Router + Query + theme providers
        routes/                     # inbox, thread, compose, settings…
        components/                 # shadcn/ui (new-york) + mail components
        styles/index.css            # Tailwind 4 @theme tokens (lifted from website, §3.2)
        hooks/                      # useMessages, useThread, useSend (TanStack Query)
        platform-context.tsx        # React context surfacing the PlatformAdapter
      components.json               # shadcn config (Tailwind 4: empty config field)
      package.json                  # deps: react, @tanstack/*, radix-ui, @mailkite/core
      tsconfig.json

  apps/
    web/                            # @mailkite/web — Vite SPA + Hono backend (web + server)
      src/
        app.ts                      # shared Hono app: /api/* + /webhook + SPA serve
        worker.ts                   # Workers entry: export default app
        node.ts                     # Node entry: serve() + serveStatic + SPA fallback
        client/
          main.tsx                  # mounts <MailApp/> with a WEB PlatformAdapter
          sw.ts                     # service worker (vite-plugin-pwa injectManifest)
      dist/client/                  # Vite output: Workers assets.dir AND Node static root
      migrations/                   # D1/SQLite migrations (portable; data-model.md §6)
      wrangler.jsonc
      vite.config.ts                # plugin-react + tailwind + vite-plugin-pwa
      Dockerfile                    # the Node/Docker artifact
      package.json

    desktop/                        # @mailkite/desktop — Tauri 2 desktop shell
      src/main.tsx                  # mounts <MailApp/> with a TAURI adapter
      vite.config.ts                # builds the SPA shell Tauri embeds (port 5176)
      dist/                         # vite build output -> frontendDist
      src-tauri/
        tauri.conf.json             # frontendDist -> ../dist; bundle targets; plugins
        Cargo.toml                  # tauri + plugins (deep-link, notification, …)
        capabilities/               # allow-list permission sets for the webview
        src/lib.rs                  # Rust: register plugins, deep-link handler
      package.json

    mobile/                         # @mailkite/mobile — Tauri 2 mobile (iOS + Android)
      src/main.tsx                  # mounts <MailApp/> with a MOBILE adapter
      vite.config.ts
      src-tauri/
        tauri.conf.json             # + tauri.ios.conf.json / tauri.android.conf.json
        gen/                        # generated by `tauri ios init` / `tauri android init`
          apple/                    # Xcode project
          android/                  # Gradle project
        Cargo.toml                  # + mobile push plugin (APNs/FCM)
        capabilities/
      package.json

  docs/
```

> The `apps/desktop` and `apps/mobile` `src/main.tsx` are **a few lines each** — inject the right
> `PlatformAdapter` and mount `<MailApp/>` from `@mailkite/ui`. All visual code lives in
> `packages/ui`; the shells add only native glue. Full Tauri internals: [`platforms.md`](platforms.md) §4 and [`repo-structure.md`](repo-structure.md) §§3, 5.

---

## 2. Workspace tooling — pnpm + Turborepo

> **Decision (2026-06): pnpm workspaces + Turborepo.** pnpm for fast, content-addressed installs and
> strict, non-hoisted `node_modules` (which catches accidental cross-package imports); Turborepo for
> the task graph + caching across `core` → `ui` → the three apps. Shared packages are consumed as
> **`workspace:*`** dependencies and built just-in-time by the task pipeline.

### 2.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 2.2 `.npmrc`

```ini
# Strict, non-hoisted layout catches accidental cross-package imports early.
# Tauri/native toolchains occasionally need a hoist escape hatch; add it narrowly
# (public-hoist-pattern) rather than turning on shamefully-hoist.
node-linker=isolated
strict-peer-dependencies=false
```

### 2.3 Root `package.json`

```jsonc
{
  "name": "@mailkite/mail",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",                          // persistent dev tasks, in parallel
    "dev:web": "turbo run dev --filter=@mailkite/web",
    "dev:desktop": "turbo run dev --filter=@mailkite/desktop",
    "dev:mobile:ios": "pnpm --filter @mailkite/mobile tauri ios dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "~6.0.2",
    "eslint": "^9.0.0"
  }
}
```

### 2.4 `turbo.json` — task pipeline + caching

Turborepo v2 uses a **`tasks`** key (the old `pipeline` key is gone). `^build` (caret) means "build
this package's workspace **dependencies** first" — so `core` builds before `ui`, and `ui` before the
apps, with caching skipping anything unchanged.

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "globalDependencies": ["tsconfig.base.json", ".npmrc"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist/client/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true                            // long-running; don't block dependents
    },
    "lint":      { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "deploy": {
      "dependsOn": ["build"],
      "cache": false                                // side-effecting; never cached
    }
  }
}
```

| Turborepo concept | How MailKite Mail uses it |
|---|---|
| `dependsOn: ["^build"]` | `core` → `ui` → apps ordering, automatic from `workspace:*` deps |
| Output caching | `dist/**` and Vite `dist/client/**` are cached; an unchanged `core` never rebuilds |
| `persistent: true` | `dev` (Vite / wrangler / `tauri dev`) doesn't exit, so Turbo doesn't wait on it |
| `--filter=@mailkite/web` | build/run only one app + its deps (e.g. CI matrix legs) |
| `cache: false` on `deploy` | deploys are side-effecting; never served from cache |
| Remote cache (optional) | `turbo login`/`link` to share the cache across CI runs and machines |

> **Note — Tauri's Rust build is its own cache.** Turbo caches the *SPA* outputs cleanly; the
> Rust/Cargo and Xcode/Gradle builds inside `src-tauri/` have their own (large, slow) caches. Cache
> those at the **CI** layer (Rust target dir, CocoaPods, Gradle), not via Turbo outputs — listing
> `src-tauri/target/**` as a Turbo output is fragile. See [`repo-structure.md`](repo-structure.md) §6.

---

## 3. The shared SPA — `packages/ui` (+ `packages/core`)

The SPA is React 19 + Vite 8 + TanStack Router + TanStack Query + shadcn/ui (new-york) + Tailwind
CSS 4, all in `packages/ui`. Versions are lifted verbatim from `dashboard/package.json` so the two
apps stay in lockstep.

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

### 3.1 How each shell consumes `@mailkite/ui` + `@mailkite/core`

`@mailkite/ui` exposes one root component, `<MailApp platform={…}/>`. It takes a `PlatformAdapter`
(from `@mailkite/core`) through React context (`platform-context.tsx`); a component that wants to fire
a notification calls `usePlatform().notify(...)`, never `navigator` or a Tauri import. That single
indirection is what lets the identical component tree run in a browser, a desktop webview, and a
mobile webview. Each shell's entry is therefore trivial — inject the adapter, mount the root:

```tsx
// apps/web/src/client/main.tsx
import { MailApp } from "@mailkite/ui";
import { webPlatform } from "./platform";          // Web Push, localStorage, window.open
createRoot(document.getElementById("root")!).render(<MailApp platform={webPlatform} />);
```

```tsx
// apps/desktop/src/main.tsx  (apps/mobile/src/main.tsx is identical bar the adapter)
import { MailApp } from "@mailkite/ui";
import { tauriPlatform } from "./platform";        // OS notify, keychain, deep links
createRoot(document.getElementById("root")!).render(<MailApp platform={tauriPlatform} />);
```

Consumption mechanics:

- Each app declares `"@mailkite/ui": "workspace:*"` (which pulls `@mailkite/core` transitively).
  pnpm symlinks them; Turbo's `^build` builds them first.
- With Vite + pnpm, importing `@mailkite/ui` source directly works when it ships an ESM entry; add it
  to `optimizeDeps.include` in each app's `vite.config.ts` so Vite pre-bundles the workspace package.
- **The client/server split in `core` is load-bearing.** `webhook.ts` + `store/*` are server-only
  (they pull `node:crypto`/SQLite) and live behind a separate `@mailkite/core/server` export. The
  browser/Tauri builds import only `@mailkite/core` (client surface), so Vite cannot bundle server
  code into a client. Detail: [`repo-structure.md`](repo-structure.md) §3.2.

### 3.2 Tailwind 4 — no config file, inline `@theme`

Tailwind 4 has **no `tailwind.config.js`**. The `@tailwindcss/vite` plugin plus `@import "tailwindcss"`
in CSS does everything; the theme is an inline `@theme` block. shadcn's `components.json` reflects this
with an empty `tailwind.config` field. Copy these verbatim from `dashboard/` into `packages/ui`:

```jsonc
// packages/ui/components.json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/styles/index.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "hooks": "@/hooks", "lib": "@/lib" }
}
```

The brand tokens are framework-agnostic CSS vars. Lift the `@theme` + light override block straight
from `website/src/styles/global.css` (cited here so this doc is self-contained — do not re-derive the
hex values):

```css
/* packages/ui/src/styles/index.css */
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

### 3.3 Provider stack

`MailApp.tsx` nests the providers: `PlatformProvider` → `QueryClientProvider` → `ThemeProvider` →
`AuthProvider` → `RouterProvider`, with `<Toaster theme={theme} />` from `sonner`. The auth layer
holds the JWT used for `/api/*` calls; the platform layer surfaces the per-shell adapter.

### 3.4 Vite config (`apps/web`)

```ts
// apps/web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],               // + vite-plugin-pwa (platforms.md §5)
  build: { outDir: 'dist/client' },                // separate from any Worker/server build
  optimizeDeps: { include: ['@mailkite/ui', '@mailkite/core'] },  // pre-bundle workspace deps
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  server: {
    port: 5175, strictPort: true,                  // dashboard=5173, admin=5174, mail=5175
    proxy: { '/api': 'http://localhost:8787', '/webhook': 'http://localhost:8787' },
  },
})
```

`outDir: dist/client` is load-bearing: it is simultaneously the Workers `assets.directory` and the
Node `serveStatic` root. One build path, two consumers. (The `apps/desktop` / `apps/mobile`
`vite.config.ts` builds the same SPA into `dist/` for Tauri's `frontendDist` — see §7.)

---

## 4. The backend — one Hono app in `apps/web`

The server is `new Hono<{ Bindings: Env }>()` in `apps/web/src/app.ts`, the same shape as
`api/src/index.ts` (`app.use('/api/*', cors())`, `app.onError`, `app.notFound`). Bindings (`DB`,
`ASSETS`, secrets) arrive on `c.env` under Workers and from `process.env` under Node — branched
**once**, at store construction (see §6). The store adapter itself lives in `@mailkite/core/server`,
so the server depends only on the `MailRepo` interface.

The whole backend is **one process**. A self-hoster runs it with a MailKite API key and a `whsec_*`
webhook secret — nothing else.

```
                                    ┌───────────────────────────────────────────┐
   Shell (SPA)                      │        apps/web — one Hono app             │
   @mailkite/ui     ───  GET /  ───▶│  static assets ──▶ React/Vite SPA (dist)   │
   TanStack Router        fetch     │                                            │
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
| **Read** | Shell → `/api/messages*` → `MailRepo` | inbound to UI | own store (read) |
| **Ingest** | MailKite → `POST /webhook` → `MailRepo` | inbound to store | own store (write) |
| **Reply** | Shell → `/api/send` → MailKite `/v1/send` | outbound | none (pure proxy) |

The app's store is the **only** mail database it reads. MailKite keeps its own copy in its D1
`messages` table, but the OSS portability story depends on MailKite Mail never reaching into it. The
single contract between them is the webhook payload and the `/v1/send` API.

### 4.1 Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/webhook` | POST | HMAC sig | Receive `email.received` from MailKite, verify, ingest |
| `/api/messages` | GET | JWT | List stored messages, newest first |
| `/api/messages/:id` | GET | JWT | Full body, headers, deliveries, attachments |
| `/api/send` | POST | JWT | Proxy a reply to MailKite `/v1/send` |
| `/api/auth/*` | POST | — | Login / session (issues the JWT the SPA carries) |
| `/*` (everything else) | GET | — | Serve the SPA (`index.html` + assets) |

### 4.2 Webhook receiver — the raw-body gotcha

The signature is `x-mailkite-signature: t=<unix_ms>,v1=<hex_hmac_sha256>`, computed as
`HMAC-SHA256(webhook_secret, "<t>." + rawBody)` with a default 5-minute tolerance. **You must verify
against the raw request body, not re-serialized JSON.** Read it once with `c.req.text()` before any
JSON parsing, and reuse it:

```ts
import { verifyWebhook } from '@mailkite/core/server'   // server-only surface

app.post('/webhook', async (c) => {
  const raw = await c.req.text()                       // RAW body — required for HMAC
  const sig = c.req.header('x-mailkite-signature') ?? ''
  const secret = getEnv(c).WEBHOOK_SECRET              // whsec_*
  if (!verifyWebhook(sig, raw, secret /*, toleranceMs */)) {
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

### 4.3 Send proxy

`/api/send` validates the JWT, then forwards to MailKite `POST /v1/send` with the account's API key.
Set `inReplyTo` to the message-id being answered — MailKite auto-derives the RFC5322 `In-Reply-To` +
`References` headers for correct threading. Body fields:
`{ from, to, subject, html?, text?, replyTo?, cc?, bcc?, inReplyTo?, headers?, attachments? }`.
`/v1/send` returns `{ id, status }`. This route is a **pure proxy** — it never writes the local store;
the eventual delivery shows up later as an `email.received` webhook only if the account also receives
its own outbound, otherwise the SPA optimistically appends the sent message.

### 4.4 Attachments

Attachment URLs in the webhook payload are MailKite signed 7-day links
(`GET /att/:mid/:idx?exp=<s>&sig=<hex>`, no auth) and the bytes behind them are deleted after 7 days.
Store the metadata (id/filename/contentType/size) **and fetch-and-rehost the bytes at ingest** into
the app's own blob store (R2 on Workers / filesystem on Node) — relying on the signed URL would lose
old mail's attachments after a week. See [`data-model.md`](data-model.md) §4.6.

---

## 5. Worker target — combined `main` + `assets`

The dashboard is a **pure assets** Worker (no `main`, no server). The API is a **`main`-only** Hono
Worker (no assets). `apps/web` is **both at once** in one config — first-class since Wrangler's
array-form `run_worker_first` (shipped 2025-06-17).

### 5.1 How routing resolves

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

### 5.2 Worker entry

```ts
// apps/web/src/worker.ts
import app from "./app";   // shared Hono app; routes mounted on /api/* and /webhook/*
export default app;        // Workers calls app.fetch with (request, env, ctx)
```

`nodejs_compat` is required because the webhook HMAC crypto touches Node APIs — the API Worker
already sets it.

---

## 6. Dual runtime — what's shared, what differs

The same `apps/web/src/app.ts` runs everywhere. Only the **entry adapter** and the **storage backend**
differ, and storage branches exactly once.

| Concern | Cloudflare Workers | Node self-host |
|---|---|---|
| Entry file | `src/worker.ts` (`export default app`) | `src/node.ts` (`serve({ fetch: app.fetch })`) |
| HTTP adapter | Workers runtime (native Fetch) | `@hono/node-server` `serve()` |
| Static SPA | `assets` binding + `not_found_handling` | `@hono/node-server/serve-static` + index.html fallback |
| Store | **D1** (`env.DB`, async, remote) | **SQLite** (`@libsql/client` or `better-sqlite3`, local) |
| Config / secrets | `c.env` (bindings) | `process.env` |
| Migrations | `wrangler d1 migrations apply` | `schema.sql` exec on boot |
| **Shared** | `src/app.ts`, all route handlers, `@mailkite/core` `MailRepo`, the SPA, the design tokens |

### 6.1 Node entry

```ts
// apps/web/src/node.ts
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

### 6.2 The storage seam (the portability point)

The `MailRepo` interface — `listThreads`, `getMessage`, `ingestWebhookMessage`, `setRead`, … — lives
in `@mailkite/core` over a pluggable `SqlDriver` (and a `BlobStore` for attachments); `app.ts` and
every route depend **only** on it. The full interface is defined in [`data-model.md`](data-model.md)
§5. Construct the concrete repo once per runtime:

- **Workers:** build from `c.env.DB` (D1). Query API: `env.DB.prepare(sql).bind(...).all()`.
- **Node:** build from a SQLite handle. Prefer `@libsql/client` for an **async** API that matches D1's
  shape, so the adapter interface is uniform (async everywhere); `better-sqlite3` works too but is
  synchronous.

Branch on runtime **only** at construction — never inside a route handler. Keep `schema.sql` portable
SQL (D1 is SQLite-compatible, so this is natural): D1 applies it via `migrations/`, Node `exec`s it on
boot. Detail lives in [`data-model.md`](data-model.md).

---

## 7. The Tauri 2 shells — how desktop & mobile load the SPA

`apps/desktop` and `apps/mobile` are Tauri 2 apps that **bundle** the shared SPA and point it at a
configured backend URL. They reuse the exact same `@mailkite/ui` + `@mailkite/core` packages — only
the `PlatformAdapter` differs. This doc covers *how they load the SPA*; the plugins, push, deep
links, secure storage live in [`platforms.md`](platforms.md) §4; the workspaces layout, signing, and
CI live in [`repo-structure.md`](repo-structure.md) §§3, 6.

### 7.1 The thin Vite entry + a Tauri adapter

Each Tauri app is its own pnpm workspace package whose Vite entry imports `@mailkite/ui` (see §3.1)
and injects a Tauri `PlatformAdapter` (OS notifications, OS keychain for the JWT, deep links). The
`src-tauri/` Rust crate lives **inside** the app package; `tauri.conf.json`'s
`frontendDist`/`beforeBuildCommand` are relative to `src-tauri/`, so they reach back up to the app's
own `dist`.

### 7.2 `tauri.conf.json` build block — bundle the SPA, don't load remote

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "MailKite Mail",
  "identifier": "app.mailn.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter @mailkite/desktop dev",
    "devUrl": "http://localhost:5176",             // Vite dev server during `tauri dev` (HMR)
    "beforeBuildCommand": "pnpm --filter @mailkite/desktop build",
    "frontendDist": "../dist"                       // a PATH (embedded), not a remote URL
  }
}
```

| `frontendDist` mode | What it means | Verdict |
|---|---|---|
| **Path** (e.g. `../dist`) | the built SPA is embedded in the binary, served over Tauri's internal protocol; the SPA then calls the configured **API** cross-origin | **chosen** — offline-capable, fast cold start, app-store-friendly, native plugin IPC available |
| **Remote URL** (e.g. `https://mailn.app`) | the app is a remote wrapper | rejected — needs network to launch, fights store "minimum functionality" rules, weakens the security model (remote-origin IPC), loses offline read |

> **Decision (2026-06): Tauri shells bundle the SPA and point it at a configured backend URL.** Embed
> the built `@mailkite/ui`; the SPA reads `VITE_BACKEND_URL` (default `https://mailn.app`, overridable
> for self-host via a first-run **Server URL** screen) and `fetch`es `/api/*` cross-origin with the
> `Bearer` JWT. The backend's CORS allow-list must include the fixed Tauri origins (`tauri://localhost`
> on macOS/iOS/Linux, `https://tauri.localhost` on Windows, `http://tauri.localhost` on Android). Full
> rationale + the per-install Server-URL seam: [`platforms.md`](platforms.md) §2 and [`repo-structure.md`](repo-structure.md) §5.

### 7.3 Mobile specifics

`apps/mobile` adds `tauri ios init` / `tauri android init`, which scaffold native projects under
`src-tauri/gen/apple` (Xcode/Swift) and `src-tauri/gen/android` (Gradle/Kotlin). For a mail app that
needs push entitlements (APNs/FCM) and deep-link associated-domains, **commit `gen/`** so those native
edits are reproducible. Dev: `tauri ios dev` / `tauri android dev` (HMR via `devUrl`); build:
`tauri ios build --export-method app-store-connect` → `.ipa`, `tauri android build --aab` → `.aab`.
Push wiring: [`platforms.md`](platforms.md) §4; signing and the CI matrix: [`repo-structure.md`](repo-structure.md) §6.

---

## 8. Copy-pasteable config

### 8.1 `apps/web/wrangler.jsonc` (combined `main` + `assets`)

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

### 8.2 `apps/web/package.json` scripts (both targets)

```jsonc
{
  "name": "@mailkite/web",
  "type": "module",
  "scripts": {
    // --- shared SPA build ---
    "build:client": "tsc -b && vite build",            // -> dist/client
    "build": "pnpm run build:client",                  // wrangler bundles src/worker.ts on deploy

    // --- Cloudflare Workers target ---
    "dev": "wrangler dev",                             // Worker + assets locally (:8787)
    "dev:client": "vite",                              // SPA on :5175, proxying /api -> :8787
    "deploy": "pnpm run build:client && wrangler deploy",
    "db:migrate": "wrangler d1 migrations apply mailkite-mail --remote",
    "db:migrate:local": "wrangler d1 migrations apply mailkite-mail --local",

    // --- Node self-host target ---
    "start": "node ./src/node.ts",                     // serves dist/client + API on $PORT
    "start:dev": "tsx watch ./src/node.ts",

    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@mailkite/core": "workspace:*",
    "@mailkite/ui": "workspace:*",
    "hono": "^4.9.0",
    "@hono/node-server": "^1.13.0"
  }
}
```

Two dev modes: **(a)** `pnpm --filter @mailkite/web dev` (Worker target) + `… dev:client` (Vite HMR
proxying to it), mirroring the dashboard's setup; or **(b)** `… start:dev` for the Node target. From
the repo root, `pnpm dev:web` runs the Turbo `dev` task for this package + its workspace deps. For a
clean self-host binary you may `tsc` the server to JS and ship `node dist/server/node.js`;
`tsx`/Node type-stripping is fine for v1.

### 8.3 `apps/desktop/package.json` scripts (Tauri shell)

```jsonc
{
  "name": "@mailkite/desktop",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5176",                         // Vite dev server Tauri's devUrl points at
    "build": "tsc -b && vite build",                   // -> dist (Tauri frontendDist)
    "tauri": "tauri",                                  // `pnpm tauri build` / `tauri dev`
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@mailkite/ui": "workspace:*",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-deep-link": "^2.0.0",
    "@tauri-apps/plugin-notification": "^2.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "vite": "^8.0.12"
  }
}
```

`apps/mobile/package.json` is the same shape (identifier `app.mailn.mobile`, adds a mobile push
plugin); its `tauri` script drives `tauri ios|android dev|build`.

Dependencies `apps/web` **adds** beyond the dashboard set: `hono ^4.9.0` (from `api/`),
`@hono/node-server` (Node entry), a SQLite driver (`@libsql/client` preferred, or `better-sqlite3`),
and optionally `postal-mime ^2.4.0` if you ever parse stored raw MIME. The webhook verify + `/v1/send`
helpers live in `@mailkite/core` (no separate SDK dependency in `apps/web`).

---

## 9. Why this shape

The dashboard has no backend of its own — it calls `api.mailkite.dev`, so pure static assets suffice.
MailKite Mail **is** its own backend: it must receive webhooks and serve signed data endpoints. Fusing
the Hono server and the SPA into one `apps/web` deployable (one Worker, one Node process) means a
self-hoster runs a single binary, and the same `app.fetch` powers both targets. Factoring the UI into
`packages/ui` + `packages/core` then lets the **same** SPA ship as Tauri desktop/mobile shells without
forking the inbox.

Trade-offs that drove the design:

- **Workspaces monorepo over one app:** one component tree reused by web + desktop + mobile, with
  platform differences isolated to a small `PlatformAdapter` per shell and server code fenced off by
  the `@mailkite/core` `exports` split. Cost: pnpm + Turbo tooling overhead; win: write the inbox once.
- **Combined `main` + `assets` over assets-only:** `apps/web` needs co-located server routes; the
  dashboard does not. The cost is one Worker bundle to maintain; the win is one process to deploy.
- **`run_worker_first` array over default SPA detection:** explicit globs disable the
  `Sec-Fetch-Mode` heuristic, giving a predictable API-vs-SPA split. Static hits skip the Worker
  entirely — cheaper and faster.
- **D1 vs SQLite divergence:** D1 is async/remote, `better-sqlite3` is sync/local. Choosing
  `@libsql/client` keeps the adapter async on both runtimes so the `MailRepo` interface is uniform.
- **Tauri 2 over Electron/Capacitor:** Electron is desktop-only and heavy; Capacitor can't do desktop.
  Tauri 2 is **one toolchain across desktop + mobile** with tiny binaries — see the decision below.
- **Raw-body HMAC:** verifying against `c.req.text()` (not re-serialized JSON) avoids the most common
  webhook failure.

> **Decision (2026-06): workspaces monorepo + dual-runtime `apps/web` + Tauri 2 shells.** One repo
> factors the UI into `packages/ui` (React) + `packages/core` (framework-agnostic client/types/store/
> webhook), built by **pnpm + Turborepo** (`workspace:*` deps, `^build` ordering, cached JS/TS).
> `apps/web` is the **one Hono backend** with two entry points — `src/worker.ts` (Cloudflare Workers,
> `main` + `assets` binding) and `src/node.ts` (`@hono/node-server` + `serveStatic`) — both serving the
> **same** `src/app.ts`; storage branches exactly once at construction (D1 on Workers, SQLite on Node).
> The **same** SPA also ships as **Tauri 2** desktop (`apps/desktop`) and mobile (`apps/mobile`)
> shells that bundle `@mailkite/ui` and point it at a configured backend URL — chosen over Electron
> (desktop-only, heavy) and Capacitor (no desktop) for one unified toolchain across desktop + mobile.
> A self-hoster needs only a MailKite API key + a `whsec_*` webhook secret — never MailKite's internal
> DB. This is the OSS install story; the shells are thin clients on top of it.

---

## See also

- [`platforms.md`](platforms.md) — the thin-client pattern in depth, the four targets, the PWA + Web Push, and the Tauri 2 desktop/mobile internals (plugins, push, deep links, secure storage)
- [`repo-structure.md`](repo-structure.md) — the pnpm + Turborepo workspaces layout, the client/server `exports` split, and the 4-artifact build/release/CI matrix (signing included)
- [`data-model.md`](data-model.md) — the storage schema, `MailRepo`/`SqlDriver`/`BlobStore` interface (in `@mailkite/core`), and D1/SQLite adapters
- [`architecture.md`](architecture.md) — signature verification + ingest pipeline + the `sandbox=""` mail iframe + JWT auth model
- [`install.md`](install.md) — the `apps/web` server self-host (`APP_URL`, secrets) that the shells' Server-URL seam points at
- [`../../docs/architecture/dashboard.md`](../../docs/architecture/dashboard.md) — the frontend stack being mirrored
- [`../../docs/architecture/api.md`](../../docs/architecture/api.md) — the Hono/Workers backend pattern
- [`../../docs/architecture/webhook-signatures.md`](../../docs/architecture/webhook-signatures.md) — the `x-mailkite-signature` scheme
- [`05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md) — superseded plan stub (§4)
