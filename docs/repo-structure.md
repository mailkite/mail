# Repo structure — the workspaces monorepo

> **One-liner:** MailKite Mail is **one** repo (`mailkite/mail`) laid out as a pnpm + Turborepo workspaces monorepo — two shared packages (`@mailkite/core`, `@mailkite/ui`) consumed by three apps (`apps/web`, `apps/desktop`, `apps/mobile`) plus `docs/` — where apps depend on packages and never the reverse, `core` is framework-agnostic, `ui` owns all React, and one task graph builds/caches everything from `core` → `ui` → the apps.

This doc is the map of the repository: the directory tree, who owns what, the dependency rules
that keep the layout honest, the pnpm + Turborepo tooling that builds it, the per-app config seams,
and the four-artifact build/release matrix. It is the "where do files go and why" companion to
[`platforms.md`](platforms.md) (the cross-platform *architecture* — thin clients, PWA,
Tauri shells) and [`stack.md`](stack.md) (the web/server *runtime* inside `apps/web`). Read this when
you need to place a file, add a dependency, or wire a new build target; read those two for the
reasoning behind the shells and the dual Node/Workers runtime.

---

## 1. Why one repo

> **Decision (2026-06): ONE repo, internally a workspaces monorepo — not multi-repo.** MailKite Mail
> lives in a single Git repository (`github: mailkite/mail`, package `@mailkite/mail`, AGPL-3.0)
> structured as a pnpm + Turborepo workspaces monorepo: shared packages (`packages/core`,
> `packages/ui`) and the deployable apps (`apps/web`, `apps/desktop`, `apps/mobile`) live side by side.
> The alternative — a repo per package/app with published npm packages between them — was **rejected**:
> the whole product is "write the inbox once, run it everywhere," and the shared UI changes in lockstep
> with the shells. A monorepo gives atomic cross-cutting commits (a `packages/ui` change + every shell
> that consumes it in one PR), one lockfile, one CI gate, no version-skew dance between internal
> packages, and `workspace:*` linking instead of publish-then-bump churn.

| Concern | One repo + workspaces (chosen) | Multi-repo (one per package/app) |
|---|---|---|
| Cross-cutting change (e.g. new field through `core` → `ui` → all shells) | one atomic PR | N PRs across N repos, ordered by publish |
| Internal versioning | `workspace:*`, no versions to bump | publish `@mailkite/core`, bump consumers, repeat |
| CI | one gate, shared Turbo cache | N pipelines, duplicated config |
| Lockfile / dep drift | single `pnpm-lock.yaml` | per-repo drift, harder to dedupe |
| Onboarding | `pnpm install` once, everything wired | clone+link N repos |
| Cost | heavier single CI; needs `--filter` discipline | lighter per repo; coordination overhead |

The shells are *thin clients* (see [`platforms.md`](platforms.md) §1), so they share almost
all of their code — exactly the case a monorepo is built for.

---

## 2. Directory tree

The whole repository, top to bottom. Trees here are copy-pasteable starting points.

```
mailkite-mail/                      # repo root (github: mailkite/mail, @mailkite/mail, AGPL-3.0)
  package.json                      # root scripts + devDeps (turbo, typescript, eslint)
  pnpm-workspace.yaml               # workspace globs
  pnpm-lock.yaml                    # the ONE lockfile for the whole repo
  turbo.json                        # task pipeline + caching
  tsconfig.base.json                # shared compiler options; each package extends it
  .npmrc                            # pnpm settings (node-linker, hoist policy)
  LICENSE                           # AGPL-3.0
  README.md

  packages/                         # shared, never deployed directly
    core/                           # @mailkite/core — framework-agnostic (NO react)
      src/
        index.ts                    # client surface barrel (types + client + platform)
        client.ts                   # typed API client (fetch /api/*, /api/send)
        types.ts                    # Message, Thread, Attachment, AuthVerdict, SendInput…
        platform.ts                 # PlatformAdapter interface (the per-shell seam, §5)
        server/
          index.ts                  # server-only barrel (kept out of client bundles)
          webhook.ts                # HMAC verify + payload→row normalize (server-only)
          store/
            repo.ts                 # makeMailRepo(driver, blobs) -> MailRepo
            d1.ts                   # D1 adapter (Workers)
            sqlite.ts               # libsql / better-sqlite3 adapter (Node)
            schema.sql              # portable schema (see data-model.md)
      package.json                  # name:@mailkite/core; exports map (./ + ./server); NO react
      tsconfig.json

    ui/                             # @mailkite/ui — React; depends on core
      src/
        MailApp.tsx                 # the SPA root (TanStack Router + providers)
        platform-context.tsx        # React context surfacing the PlatformAdapter
        routes/                     # inbox, thread, compose, settings…
        components/                 # shadcn/ui (new-york) + mail components
        hooks/                      # useMessages, useThread, useSend (TanStack Query)
        styles/index.css            # Tailwind 4 @theme tokens (lifted from website)
      components.json               # shadcn config (Tailwind 4: empty config field)
      package.json                  # deps: react, @tanstack/*, radix-ui, @mailkite/core
      tsconfig.json

  apps/                             # deployable; each depends on packages/*
    web/                            # @mailkite/web — Vite SPA + the Hono backend (web + server)
      src/
        app.ts                      # shared Hono app: /api/* + /webhook + SPA serve
        worker.ts                   # Workers entry (export default app)
        node.ts                     # Node entry (@hono/node-server + serveStatic)
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
      src/
        main.tsx                    # mounts <MailApp/> with a TAURI desktop adapter
      index.html
      vite.config.ts                # builds the SPA shell Tauri embeds (outDir ../dist, port 5176)
      dist/                         # vite build output -> frontendDist
      src-tauri/
        tauri.conf.json             # frontendDist -> ../dist; bundle targets; plugins
        Cargo.toml                  # tauri + plugins (deep-link, notification, keyring…)
        capabilities/default.json   # ACL: which plugin permissions the webview may use
        src/lib.rs                  # Rust: register plugins, deep-link handler
        icons/
      package.json                  # deps: @mailkite/ui (workspace:*), @tauri-apps/api, vite

    mobile/                         # @mailkite/mobile — Tauri 2 mobile (iOS + Android)
      src/
        main.tsx                    # mounts <MailApp/> with a MOBILE adapter
      index.html
      vite.config.ts
      dist/
      src-tauri/
        tauri.conf.json             # + tauri.ios.conf.json / tauri.android.conf.json
        Cargo.toml                  # + mobile push plugin (APNs/FCM)
        capabilities/default.json
        gen/                        # GENERATED by `tauri ios/android init` — commit (see §6.2)
          apple/                    # Xcode project (Swift shell)
          android/                  # Gradle project (Kotlin shell)
        icons/
      package.json                  # deps: @mailkite/ui (workspace:*), @tauri-apps/api, vite

  docs/                             # this docs set (00-overview, stack, architecture, …)
```

> Each Tauri shell is its **own** workspace package with `src-tauri/` *inside* it; `tauri.conf.json`'s
> `frontendDist`/`beforeBuildCommand` are relative to `src-tauri/`, so they reach back up to that app's
> own `dist/`. The shell's `src/main.tsx` is a **few lines** — inject the right `PlatformAdapter` and
> mount `<MailApp/>` from `@mailkite/ui`. All visual code lives in `packages/ui`; the shells add only
> native glue.

---

## 3. Package boundaries — who owns what

The single rule that makes the whole layout work:

> **Apps depend on packages; packages never depend on apps. `@mailkite/core` is framework-agnostic
> (no React); `@mailkite/ui` owns all the React.** Dependency arrows point strictly inward:
> `core` ← `ui` ← every app. Nothing flows the other way, and no app imports another app.

```
        ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
        │  apps/web    │     │ apps/desktop │     │ apps/mobile  │   (deployables)
        └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
               │ workspace:*        │ workspace:*        │ workspace:*
               └──────────┬─────────┴──────────┬─────────┘
                          ▼                     ▼
                 ┌──────────────────┐   (web also imports
                 │  @mailkite/ui    │    @mailkite/core/server
                 │  (all React)     │    directly for the Hono
                 └────────┬─────────┘    backend — see below)
                          │ workspace:*
                          ▼
                 ┌──────────────────┐
                 │ @mailkite/core   │  framework-agnostic; NO react dep
                 └──────────────────┘
```

### 3.1 What each owns

| Workspace | Owns | Depends on | Must NOT |
|---|---|---|---|
| `@mailkite/core` | types (`Message`, `Thread`, …), the API client, the webhook + own-store logic, the storage adapter (`MailRepo`/`SqlDriver`/`BlobStore`, D1/SQLite), the `PlatformAdapter` interface | nothing internal; no `react` | import `react`, `@mailkite/ui`, or any app |
| `@mailkite/ui` | `MailApp.tsx` (SPA root), every screen/route/component, shadcn primitives, Tailwind 4 tokens, the `platform-context` that surfaces the adapter | `@mailkite/core` (client surface only) | touch `navigator.*`/Tauri APIs directly (go through `PlatformAdapter`); import any app |
| `apps/web` | the Hono backend (`/api/*` + `/webhook` + SPA serve), Workers + Node entries, the PWA service worker, migrations, Docker + wrangler config | `@mailkite/core` (incl. `/server`) + `@mailkite/ui` | be imported by another package/app |
| `apps/desktop` | the Tauri 2 desktop shell + Rust crate, desktop `PlatformAdapter`, native glue (keychain, deep links, notifications) | `@mailkite/ui` + `@mailkite/core` (client) | hold the `mk_live_*` key or host the webhook receiver |
| `apps/mobile` | the Tauri 2 iOS/Android shell + Rust crate + `gen/` native projects, mobile `PlatformAdapter`, native push (APNs/FCM) | `@mailkite/ui` + `@mailkite/core` (client) | hold the `mk_live_*` key or host the webhook receiver |

### 3.2 The client/server split inside `core`

`@mailkite/core` ships **two** entry points via its `exports` map so server-only code (`webhook.ts`,
`store/*` — which drag in `node:crypto` / SQLite) can never tree-shake into a browser or Tauri webview
bundle. The clients import `@mailkite/core` (client surface); only `apps/web`'s backend imports
`@mailkite/core/server`.

```jsonc
// packages/core/package.json — the exports map IS the boundary
{
  "name": "@mailkite/core",
  "type": "module",
  "exports": {
    ".":        { "types": "./src/index.ts",        "default": "./src/index.ts" },
    "./server": { "types": "./src/server/index.ts", "default": "./src/server/index.ts" }
  }
}
```

| Import | Allowed in | Contains |
|---|---|---|
| `@mailkite/core` | `ui`, every app's client, tests | types, `client.ts`, `PlatformAdapter` |
| `@mailkite/core/server` | **`apps/web` server only** | `webhook.ts` (HMAC), `store/*` (D1/SQLite) |

The full storage adapter (`MailRepo`/`SqlDriver`/`BlobStore`) is specified in
[`data-model.md`](data-model.md); the dual-runtime backend that consumes `/server` is in
[`stack.md`](stack.md) §5. Why `ui` consumes the adapter through `core` (not directly) is in
[`platforms.md`](platforms.md) §1.

---

## 4. Tooling — pnpm workspaces + Turborepo

> **Decision (2026-06): pnpm workspaces for linking + Turborepo for the task graph.** pnpm gives
> fast, content-addressed installs and a strict, non-hoisted `node_modules` that catches accidental
> cross-package imports; Turborepo gives the `core` → `ui` → apps task ordering plus output caching.
> Shared packages are `workspace:*` dependencies, built just-in-time by the pipeline.

### 4.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

### 4.2 `.npmrc`

```ini
# Strict, non-hoisted layout surfaces accidental cross-package imports early.
# Tauri/native toolchains occasionally need a hoist escape hatch — add it
# narrowly via public-hoist-pattern, never shamefully-hoist=true.
node-linker=isolated
strict-peer-dependencies=false
```

### 4.3 Root `package.json`

```jsonc
{
  "name": "@mailkite/mail",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",                       // persistent dev tasks, in parallel
    "dev:web": "turbo run dev --filter=@mailkite/web",
    "dev:desktop": "turbo run dev --filter=@mailkite/desktop",
    "dev:mobile:ios": "pnpm --filter @mailkite/mobile tauri ios dev",
    "dev:mobile:android": "pnpm --filter @mailkite/mobile tauri android dev",
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

### 4.4 `turbo.json` — task pipeline + caching

Turborepo v2 uses the **`tasks`** key (the old `pipeline` key is removed). `^build` (the caret) means
"build this package's workspace **dependencies** first" — so `core` builds before `ui`, `ui` before the
apps, with caching skipping anything unchanged.

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "globalDependencies": ["tsconfig.base.json", ".npmrc"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist/client/**", "!src-tauri/target/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true                          // long-running; never blocks dependents
    },
    "lint":      { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "deploy": {
      "dependsOn": ["build"],
      "cache": false                              // side-effecting; never cached
    }
  }
}
```

| Turborepo concept | How this repo uses it |
|---|---|
| `dependsOn: ["^build"]` | `core` → `ui` → apps ordering, derived automatically from `workspace:*` deps |
| Output caching | `dist/**` and Vite `dist/client/**` are cached; an unchanged `core` never rebuilds |
| `persistent: true` | `dev` (Vite / wrangler / `tauri dev`) doesn't exit, so Turbo doesn't wait on it |
| `--filter=@mailkite/web` | build/run only one app + its deps (CI matrix legs, §6) |
| `cache: false` on `deploy` | deploys are side-effecting — never served from cache |
| Remote cache (optional) | `turbo login` + `turbo link` shares the cache across CI runs and machines |

> **Note — Turbo owns the JS/TS build only; native builds cache at the CI layer.** The Rust/Cargo,
> Xcode/CocoaPods, and Gradle builds inside `src-tauri/` have their own large, slow caches. Listing
> `src-tauri/target/**` as a Turbo output is fragile (hence the `!src-tauri/target/**` exclusion
> above). Cache those in the **per-OS CI jobs** (`Swatinem/rust-cache`, CocoaPods, Gradle), not via
> Turbo (§6.2).

---

## 5. Per-app config seams

Two things vary per app: **where the backend is** and **which native capabilities exist**. Both are
funneled through one interface (`PlatformAdapter`, defined in `@mailkite/core`) so `@mailkite/ui` stays
platform-blind. Full detail is in [`platforms.md`](platforms.md) §4; the structural summary:

| App | Backend URL seam | Native capabilities seam |
|---|---|---|
| `apps/web` | implicit **same-origin** (`""`) — the SPA is served by its own Hono backend | web `PlatformAdapter`: `localStorage` token, SW Web Push, in-app routing |
| `apps/desktop` | **configured** `https://…` (first-run **Server URL**, persisted in Tauri store; default `https://mailn.app`) | desktop `PlatformAdapter`: OS keychain, `plugin-notification`, `plugin-deep-link`; declared in `src-tauri/capabilities/` |
| `apps/mobile` | same first-run **Server URL** (deep link `mailkite://connect?url=…` can prefill) | mobile `PlatformAdapter`: iOS Keychain / Android Keystore, native APNs/FCM push, app/universal links |

The desktop/mobile shells are **never hard-coded to mailn.app** — a self-hoster enters their own
`https://mail.acme.com`. That single value is the only per-install config; it mirrors `APP_URL` on the
server (see [`install.md`](install.md)). Because those shells call the backend cross-origin, the Hono
backend must allow the fixed Tauri origins in CORS (`tauri://localhost`, `https://tauri.localhost`,
`http://tauri.localhost`); the Tauri shell CSP must permit `connect-src` to the configured backend
(both detailed in [`platforms.md`](platforms.md) §4).

```ts
// packages/core/src/platform.ts — implemented once per shell, consumed by ui via context
export interface PlatformAdapter {
  readonly kind: "web" | "desktop" | "ios" | "android";
  backendUrl(): string;                          // same-origin (web) | configured URL (native)
  getToken(): Promise<string | null>;            // localStorage (web) | OS keychain (native)
  setToken(t: string | null): Promise<void>;
  notify(n: { title: string; body: string; threadId?: string }): Promise<void>;
  setBadgeCount(n: number): Promise<void>;
  onDeepLink(cb: (url: string) => void): void;   // mailkite://thread/<id>
  registerPush?(): Promise<string | null>;       // Web Push sub | APNs/FCM token
}
```

---

## 6. Build & release matrix

Each app produces its own artifact(s) on its own toolchain. Turbo orchestrates the shared JS/TS build
(`core` + `ui` + the app's client), then per-target steps take over. **Build/deploy only what
changed** — use `turbo --filter` plus path filters.

| # | Artifact | Source app | Build command | Output | Release target |
|---|---|---|---|---|---|
| 1 | **Web Worker** | `apps/web` | `pnpm --filter @mailkite/web build` → `wrangler deploy` | Worker + `dist/client` assets + D1 | Cloudflare → **mailn.app** |
| 2 | **Node / Docker** | `apps/web` | `pnpm --filter @mailkite/web build` → `docker build` | `ghcr.io/mailkite/mail:<tag>` | self-host (see [`install.md`](install.md)) |
| 3 | **Desktop installers** | `apps/desktop` | `pnpm --filter @mailkite/desktop tauri build` | `.dmg` / `.msi`+`.exe` / `.AppImage`+`.deb`+`.rpm` | GitHub Releases + Tauri updater |
| 4 | **Mobile bundles** | `apps/mobile` | `tauri ios build` / `tauri android build` | `.ipa` (App Store) / `.aab`+`.apk` (Play) | App Store Connect / Play Console |

Artifacts 1 and 2 are the **same `apps/web` build** wrapped two ways (the dual Node/Workers runtime —
[`stack.md`](stack.md) §5). Artifacts 3 and 4 each embed the **same `@mailkite/ui` SPA** and point it
at a configured backend ([`platforms.md`](platforms.md) §2).

### 6.1 CI matrix

```yaml
# .github/workflows/release.yml (sketch)
jobs:
  # Shared gate — runs on every PR; Turbo (remote) cache makes it fast.
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test build   # remote-cache hits skip unchanged work

  web:                          # artifact 1 — Cloudflare
    needs: check
    runs-on: ubuntu-latest
    steps:
      - run: pnpm --filter @mailkite/web run deploy      # wrangler deploy
      - run: pnpm --filter @mailkite/web run db:migrate  # d1 migrations apply --remote

  docker:                       # artifact 2 — GHCR
    needs: check
    runs-on: ubuntu-latest
    steps:
      - run: docker buildx build --platform linux/amd64,linux/arm64 \
               -t ghcr.io/mailkite/mail:${{ github.ref_name }} --push apps/web

  desktop:                      # artifact 3 — runner-per-OS (Tauri can't cross-compile)
    needs: check
    strategy: { matrix: { os: [macos-latest, windows-latest, ubuntu-latest] } }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2                     # cache the Rust target dir
      - uses: tauri-apps/tauri-action@v0                 # build + sign + draft a release

  mobile:                       # artifact 4 — macOS for iOS, any OS for Android
    needs: check
    strategy:
      matrix:
        include:
          - { os: macos-latest,  t: ios }
          - { os: ubuntu-latest, t: android }
    runs-on: ${{ matrix.os }}
    steps:
      - run: pnpm --filter @mailkite/mobile tauri ${{ matrix.t }} build
      # iOS: Apple Developer cert + provisioning profile in secrets; signs via Xcode.
      # Android: upload keystore in secrets for the AAB.
```

### 6.2 CI notes

- **Tauri cannot cross-compile.** Desktop installers need a **runner per OS** (macOS for `.dmg`,
  Windows for `.msi`, Linux for `.AppImage`/`.deb`/`.rpm`); iOS bundles need a **macOS** runner with
  full Xcode. This is the main CI cost.
- **Signing is per-store.** Desktop: Apple notarization (macOS) + Authenticode (Windows). iOS: Apple
  Developer cert + provisioning profile, signed through Xcode. Android: an upload keystore for the AAB.
  All signing material lives in CI secrets.
- **Commit `src-tauri/gen/`.** A mail app needs hand-edited native push entitlements (APNs) and
  associated-domains/intent-filters for deep links, so commit `apps/mobile/src-tauri/gen/apple` and
  `gen/android` rather than regenerating — it keeps CI reproducible and preserves the manual native
  edits.
- **Cache split.** Turbo caches JS/TS outputs (and, via remote cache, across CI runs); native caches
  (Rust target dir, CocoaPods, Gradle) live in the per-OS jobs (§4.4). Don't make Turbo own the
  Rust/Xcode/Gradle caches.
- **Versioning.** One repo version (`@mailkite/mail`) drives all four artifacts; a tag fans out across
  the matrix. The server (artifacts 1–2) can ship continuously; the store artifacts (3–4) cut on
  tagged releases because of review latency. Because shells are thin clients, a breaking `/api/*`
  change must stay backward-compatible with already-installed desktop/mobile builds (keep `/api/*`
  additive or versioned — the shells update on their own schedule, [`platforms.md`](platforms.md) §1).

---

## See also

- [`platforms.md`](platforms.md) — the cross-platform architecture: thin-client contract, PWA + Web Push, the Tauri 2 desktop/mobile shells, and the `PlatformAdapter` seams this layout exists to serve.
- [`stack.md`](stack.md) — the web/server runtime inside `apps/web` (the dual Node/Workers Hono target the shared packages plug into).
- [`data-model.md`](data-model.md) — the `MailRepo`/`SqlDriver`/`BlobStore` storage adapter that lives in `@mailkite/core/server`.
- [`architecture.md`](architecture.md) — the two seams, the `sandbox=""` mail iframe, and the JWT auth model the apps reuse.
- [`install.md`](install.md) — the server self-host (`APP_URL`, secrets) the desktop/mobile **Server URL** seam points at.
- [`00-overview.md`](00-overview.md) — the locked decisions (webhook-only ingest, own store, thin clients) this repo implements.
