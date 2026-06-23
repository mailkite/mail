# Platforms — one SPA, many thin shells

> **One-liner:** MailKite Mail ships **one** React/Vite SPA across four targets — the Hono-served web app, an installable PWA, a Tauri 2 desktop app, and a Tauri 2 mobile app (iOS + Android) — where every client is a **thin client** to the server-side Hono backend (`apps/web`), because the webhook receiver and the own store cannot live on a device.

This doc is the cross-platform **client** strategy: the one-codebase principle, the four delivery targets, why Tauri 2 (vs Electron and Capacitor), how each native capability is wired, the PWA baseline, and the app-store + signing realities. It is the "which shells, and why" companion to [`repo-structure.md`](repo-structure.md) (the monorepo layout, `packages/core` + `packages/ui` factoring, the `PlatformAdapter` seam, and the build/CI matrix). For the web/server runtime every shell points at, see [`stack.md`](stack.md); for the seams + auth model the thin clients reuse, see [`architecture.md`](architecture.md).

---

## 1. The principle — one React SPA, many thin shells

The inbox is written **once** as a React + Vite SPA (factored into the shared workspace packages `@mailkite/core` and `@mailkite/ui` — see [`repo-structure.md`](repo-structure.md) §3). Every platform is a thin shell that loads that **same** SPA and points it at a backend over HTTP. The security-critical tier — the HMAC-verified webhook receiver, the `mk_live_*` API key, and the own store — stays on the server, on exactly one place: `apps/web`'s Hono app, running on Cloudflare Workers or Node.

```
        web         PWA         desktop        mobile
     (browser)   (installed)   (Tauri 2)    (Tauri 2 iOS/Android)
         │           │             │              │
         │ same-     │ same-       │ cross-       │ cross-
         │ origin    │ origin      │ origin       │ origin
         │ /api/*    │ /api/*      │ https://…    │ https://…
         └───────────┴──────┬──────┴──────────────┘
                            ▼
              ┌──────────────────────────────────┐
              │   apps/web  Hono backend          │
              │   POST /webhook (HMAC verify)     │◄── MailKite email.received
              │   /api/*    (JWT)  ─► own store    │
              │   POST /api/send ─► /v1/send ──────┼──► MailKite (mk_live_*)
              └──────────────────────────────────┘
                  one server tier · D1 (Workers) / SQLite (Node)
```

> **Why the receiver + store can't move onto a device (the load-bearing constraint).** `email.received` is an inbound HTTPS POST from MailKite — it needs a stable public URL and the `whsec_*` secret to verify, and the own store must be continuously reachable to ingest it. A laptop or phone has neither a public URL nor a safe place to hold `mk_live_*`. So the server tier is non-negotiable, and **all** UI shells are read/reply clients over `/api/*`. This is exactly why the desktop-vs-mobile-vs-web choice is a *UI-shell* choice only — none of these frameworks could host the backend either.

The payoff: write the inbox once, run it everywhere, and keep HMAC verification, the API key, and the store on one tier. Each shell adds only native glue (notifications, deep links, secure token storage) through one small adapter — see §4 and [`repo-structure.md`](repo-structure.md) §5.

---

## 2. The four targets

| Target | Tech | What's shared | What's per-platform | Status |
|---|---|---|---|---|
| **Web** | React/Vite SPA served by `apps/web`'s Hono app | `@mailkite/core` + `@mailkite/ui` (the whole SPA) | a Web `PlatformAdapter` (`localStorage` token, `window.open` deep links) | **V1 — primary** |
| **PWA** | the web app + manifest + service worker (`vite-plugin-pwa`), installable | same SPA; same backend (same-origin) | SW precache + **Web Push** (VAPID) subscription | **V1 — free baseline** |
| **Desktop** | Tauri 2 (`apps/desktop`) wrapping the SPA; WebView2 / WKWebView / WebKitGTK | same SPA; a thin Vite entry mounts `<MailApp/>` | OS notifications, keychain token, deep links, dock/taskbar badge, updater | **V2** |
| **Mobile** | Tauri 2 (`apps/mobile`) for iOS + Android; WKWebView / Android System WebView | same SPA; a thin Vite entry mounts `<MailApp/>` | native APNs/FCM push, OS Keychain/Keystore token, app-icon badge, app/universal links | **V2** |

What "shared" means concretely: the web and PWA shells are the *same* `apps/web` build; the desktop and mobile shells are separate Tauri apps that **bundle** the identical `@mailkite/ui` SPA and point it at a configured backend URL. The only thing that varies per shell is the injected `PlatformAdapter` (§5) and the backend URL (same-origin for web/PWA, a configured `https://…` for the Tauri shells).

> **Bundle the SPA in the Tauri shells; never load it remotely.** Tauri's `frontendDist` *can* be a remote URL (`https://mailn.app`), turning the shell into a glorified browser tab — **do not.** Embed the built SPA so the app launches offline, starts fast, satisfies app-store "minimum functionality" rules, and lets a strict shell CSP forbid remote script while still allowing API/image fetches to the configured origin. The SPA reads `VITE_BACKEND_URL` (or a first-run **Server URL** setting) and calls `/api/*` cross-origin with the `Bearer` JWT. See [`repo-structure.md`](repo-structure.md) §5.

---

## 3. Why Tauri 2

Tauri 2 (stable since 2024-10) is the only mainstream webview-wrapper that covers **desktop and mobile from one toolchain** — the exact shape we need to ship the same SPA to four targets without a second native stack.

| Concern | **Tauri 2 (chosen)** | Electron | Capacitor |
|---|---|---|---|
| Desktop targets | macOS / Windows / Linux | macOS / Windows / Linux | **none** |
| Mobile targets | **iOS + Android** (one toolchain) | **none** | iOS + Android |
| One toolchain desktop **+** mobile | **yes** | no (desktop only) | no (mobile only) |
| Bundle size | **~3–10 MB** (system webview) | ~85–150 MB (bundles Chromium) | mobile app size (system webview) |
| Rendering engine | system webview (WebView2 / WKWebView / WebKitGTK) | bundled Chromium (identical everywhere) | per-platform system webview |
| Native extension lang | Rust (+ Swift/Kotlin for mobile plugins) | Node.js | JS + Swift/Kotlin |
| Auto-update | built-in updater (desktop); mobile via stores | electron-updater | stores + live-update services |
| Security model | ACL capabilities, no Node in renderer | full Node in renderer (heavier surface) | per-platform |
| Mobile maturity | younger; **no official push** plugin yet (community plugins) | n/a | most mature mobile webview path |

> **Decision (2026-06): Tauri 2 for the desktop and mobile shells; Electron and Capacitor rejected.** Tauri 2 gives **one unified toolchain across desktop and mobile** from the same `@mailkite/ui` SPA, tiny binaries (system webview, not a bundled Chromium), and a strong allow-list security model. **Electron is rejected** — desktop-only (can't do mobile at all), and ~85–150 MB per app because it bundles Chromium. **Capacitor is rejected** — mobile-only (no desktop target), which would force a *second* toolchain alongside an Electron desktop build; Tauri's one-stack story wins. The honest costs we accept: cross-webview rendering needs QA on WebKit (mac/iOS/Linux) vs Chromium (Win/Android); mobile push needs a young community plugin + manual native wiring; advanced native work means touching Rust/Swift/Kotlin. None of these block a thin mail client whose heavy lifting is server-side.

---

## 4. Native capabilities — and how each is wired

Every native feature is reached through the **`PlatformAdapter`** interface (defined in `@mailkite/core`, consumed by `@mailkite/ui` via React context — see [`repo-structure.md`](repo-structure.md) §5), so the component tree stays platform-blind. Each shell supplies one implementation. Tauri plugins are added with `tauri add <name>` and granted permissions in `src-tauri/capabilities/*.json` (Tauri 2's ACL is allow-list by default).

| Capability | Web / PWA | Tauri desktop | Tauri mobile | How it's wired |
|---|---|---|---|---|
| **Notifications (local)** | SW `showNotification` (Web Push) | `tauri-plugin-notification` | `tauri-plugin-notification` (Android: `createChannel()` first, or it's silently dropped) | `usePlatform().notify({title, body, threadId})`; rendered by the OS |
| **Push transport** | **Web Push (VAPID)** | OS notification (foreground) + Web Push if desired | **native APNs (iOS) / FCM (Android)** via a community plugin | fired from the **one ingest seam** (§6.3): the verified webhook handler fans out to each subscription's transport |
| **Deep links** | in-app URL routing | `tauri-plugin-deep-link` (`mailkite://thread/:id`) + `tauri-plugin-single-instance` | same plugin; associated-domains (iOS) / `assetlinks.json` (Android) | `onDeepLink(cb)` routes into TanStack Router |
| **Badge count** | PWA app badge where supported | dock (macOS) / taskbar overlay (Windows) via `app.setBadgeCount(n)` | iOS app-icon badge; Android via notification | `setBadgeCount(unread)` driven by the unread count |
| **Secure token storage** | `localStorage` (safe: mail renders in a `sandbox=""` iframe, [`architecture.md`](architecture.md) §7) | OS keychain via `tauri-plugin-keyring` | iOS Keychain / Android Keystore | `getToken`/`setToken` — **never `localStorage` on native** |
| **Offline read cache** | SW precache + TanStack Query persistence | bundled shell + `tauri-plugin-store`/`tauri-plugin-sql` (read mirror) | bundled shell + local cache | client read cache only; the server own store stays canonical |
| **File save (attachments)** | browser download | `tauri-plugin-dialog` (save) + `tauri-plugin-fs` (write) | native share/save sheet | fetch attachment bytes from `/api/*`, then save; FS scoped in `capabilities/` |

> **Why mobile push is native, not Web Push.** Tauri's mobile webview (WKWebView on iOS) has **no service workers**, so there is no `PushManager` inside the Tauri mobile app — Web Push is structurally unavailable there. Mobile push therefore goes through a Tauri **native** push plugin (APNs/FCM); the server sends to device tokens instead of Web Push subscriptions. There is **no official Tauri push plugin yet** (tracked upstream) — pick **one** community plugin (`tauri-plugin-mobile-push`, `Choochmeque/tauri-plugin-notifications`, etc.), pin it, and isolate it behind `PlatformAdapter.registerPush`. Avoid `tauri-plugin-stronghold` for token storage — it's deprecated and removed in v3; use `tauri-plugin-keyring`.

---

## 5. The PWA baseline

Before any native packaging, the web app is **installable** on phones and desktops straight from the browser. This is the zero-cost baseline that makes the Tauri shells an enhancement, not a requirement.

> **Decision (2026-06): ship the PWA first; the Tauri shells are an enhancement.** A manifest + service worker makes `apps/web` installable on Android (full Web Push), desktop Chrome/Edge/Firefox (full Web Push), and iOS/iPadOS 16.4+ (Web Push **only** once added to the Home Screen). That covers "I just want it on my phone/desktop" without any app store. The Tauri shells add native niceties (reliable push, keychain, deep links, store presence) on top of the same SPA.

- **Manifest + service worker.** `vite-plugin-pwa` with `strategies: 'injectManifest'` so we own `apps/web/src/client/sw.ts` — needed because we add **Web Push** handlers Workbox won't generate. The manifest uses the brand `--color-bg` (`#0b0d12`) for `theme_color`/`background_color`. The `vite-plugin-pwa` config lives in [`stack.md`](stack.md) §8.
- **Service worker** precaches the app shell (offline read) and handles `push` → `showNotification` and `notificationclick` → `clients.openWindow('/thread/:id')` (deep link).
- **Web Push (VAPID)** is fired from the **one ingest seam** (the verified webhook receiver): client subscribes via `pushManager.subscribe`, POSTs the `PushSubscription` to `/api/push/subscribe`, the server stores it, and on each ingest it sends a VAPID-signed push. The ingest-seam fan-out is in [`features.md`](features.md) §6.

| Platform | Web Push | Caveat |
|---|---|---|
| Android Chrome / Firefox | full | works in a tab and installed PWA |
| Desktop Chrome / Edge / Firefox | full | — |
| **iOS / iPadOS Safari 16.4+** | **only when installed to Home Screen** | a Safari **tab** has no `PushManager`; prompt on a user gesture after Add to Home Screen |
| iOS in the EU | may open in a Safari tab (no push) under DMA changes | this gap is exactly why the **Tauri mobile** shell (native APNs) exists |

> **The iOS Web Push gap is the reason native mobile matters.** Web Push on iOS requires home-screen install and is fragile (notably in the EU). The Tauri mobile shell sidesteps it entirely with native APNs (§4) — so the PWA is the baseline and native mobile is the reliable-push upgrade.

---

## 6. App-store + signing realities

The biggest non-code cost of the native shells is store review and code signing. The thin-but-native plan is designed to clear the bars.

### 6.1 App-store rules

| Store | Requirement | Note |
|---|---|---|
| **Apple App Store (iOS)** | clears Guideline 4.2 / "minimum functionality" | Apple rejects apps that are "just a website in a webview." A **bundled** SPA with genuine native integration (push, deep links, offline cache, Keychain, OS share) clears the bar; a remote-URL wrapper is at risk — which is the second reason we bundle the SPA (§2). |
| **Google Play (Android)** | `.aab` (App Bundle) + recent `targetSdk` | far more permissive about webview apps |
| Both | privacy disclosures (email content handling) | relevant for a mail client; declare data handling in both consoles |

### 6.2 Signing per target

| Target | Artifacts | Signing | Notes |
|---|---|---|---|
| macOS | `.app`, `.dmg` | Apple Developer ID cert + **notarization** | Tauri signs, uploads to Apple's notary service, and staples when env creds are present (`APPLE_*`) |
| Windows | `.msi` (WiX), `.exe` (NSIS) | Authenticode (`certificateThumbprint` / Azure Trusted Signing) | required to avoid SmartScreen; EV cert for instant trust |
| Linux | `.deb`, `.rpm`, `.AppImage` | GPG optional (AppImage) | WebKitGTK is a runtime dependency on the user's box |
| iOS | `.ipa` | Apple Developer Program cert + provisioning profile (Xcode build system) | macOS runner only; `tauri ios build --export-method app-store-connect` |
| Android | `.aab` (Play), `.apk` (sideload) | upload keystore wired into `gen/android` Gradle | `tauri android build --aab`; any-OS runner |

> **Tauri cannot cross-compile.** Desktop installers need a **runner per OS** (macOS for `.dmg`, Windows for `.msi`, Linux for `.AppImage`/`.deb`); iOS bundles need a **macOS** runner with Xcode + CocoaPods. The desktop shells get the in-app **updater plugin** (signed manifest); **mobile updates ship through the stores** (no Tauri updater on mobile). The full CI matrix and signing-secret wiring live in [`repo-structure.md`](repo-structure.md) §6.

---

## 7. Decision

> **Decision (2026-06): one React SPA, four shells — web + PWA now, Tauri 2 desktop + mobile next; Electron rejected.** The inbox is one React/Vite SPA (`@mailkite/core` + `@mailkite/ui`) consumed by four thin shells. **Web** (served by `apps/web`'s Hono app) and an installable **PWA** with Web Push are the V1 baseline. **Desktop** and **mobile** ship as **Tauri 2** apps (`apps/desktop`, `apps/mobile`) that bundle the same SPA and point it at a configured backend URL — chosen for **one unified toolchain across desktop and mobile**, ~3–10 MB binaries (system webview), and an allow-list security model. **Electron is rejected** (desktop-only, ~85–150 MB) and **Capacitor is rejected** (mobile-only, would force a second toolchain). Every shell is a thin client to the one server tier; the webhook receiver, the `mk_live_*` key, and the own store never leave the server. Native features (notifications, push, deep links, badges, secure token storage, offline cache, file save) are reached through one `PlatformAdapter` so the component tree stays platform-blind.

---

## See also

- [`repo-structure.md`](repo-structure.md) — the implementation: the pnpm + Turborepo workspaces monorepo, `packages/core` + `packages/ui` factoring, the `PlatformAdapter` interface, the per-app config seams, and the 4-artifact build/release/CI matrix.
- [`stack.md`](stack.md) — the web/server runtime every shell points at: the dual Node/Workers Hono target + Vite SPA + lifted design tokens.
- [`architecture.md`](architecture.md) — the two seams, the `sandbox=""` mail iframe, and the JWT auth model the thin clients reuse.
- [`00-overview.md`](00-overview.md) — the locked decisions (webhook-only ingest, own store, thin clients) this strategy implements across platforms.
- [`features.md`](features.md) — the multi-platform feature tiers and the one-ingest-seam push fan-out.
- [`install.md`](install.md) — the server self-host (`APP_URL`, secrets) that the desktop/mobile **Server URL** seam points at.
