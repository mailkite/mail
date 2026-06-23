# MailKite Mail — Overview

> **One-liner:** MailKite Mail is an open-source, webhook-driven webmail client — **one React codebase that ships to web, desktop, and mobile** as thin clients to a self-hostable backend that ingests mail from MailKite's webhook into its own store and sends via MailKite's API, so anyone can self-host a real inbox with nothing but an API key and a webhook secret.

MailKite Mail is the open-source webmail client for [MailKite](../../README.md). It is the human-facing inbox for webhook email: a place to browse, search, read, thread, and reply to mail that arrives as `email.received` webhook payloads — no mail server to run, no IMAP/POP to configure, no SMTP relay to babysit. And it's the **same inbox everywhere** — browser, installable PWA, desktop app, and mobile app — built from one codebase, not rewritten per platform.

This is the orientation doc. For the concrete pieces, see the [companion docs](#7-the-doc-set).

---

## 1. What MailKite Mail is

MailKite Mail is a complete, self-hostable webmail client built on the same modern stack as the MailKite dashboard — React + Vite + TanStack Router + shadcn/ui + Tailwind CSS 4, served by a single [Hono](https://hono.dev) app that runs **both** on Cloudflare Workers (SPA via the assets binding) **and** on Node via `@hono/node-server`. That dual target is the backend install story.

It is also **one React UI across many shells.** The repo is a pnpm + Turborepo workspaces monorepo (`packages/core`, `packages/ui`, `apps/{web,desktop,mobile}`): the same SPA ships four ways — as the Hono-served **web** app, an installable **PWA**, a Tauri 2 **desktop** app (macOS/Windows/Linux), and a Tauri 2 **mobile** app (iOS + Android). Every client is a **thin client** to the server-side Hono backend — the webhook receiver and the store live only on the server, never on a device. There is no native rewrite per platform: the shells bundle the *same* SPA and point it at a configured backend URL. See [`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md).

It does exactly two things at the boundary:

- **Receives** mail through one HMAC-verified webhook (`email.received`) and writes it to **its own database** — SQLite on Node, D1 on Workers.
- **Sends** replies and new mail through one API call (`POST /v1/send`), which handles RFC5322 threading and deliverability for it.

It never speaks SMTP, never opens an IMAP/POP connection, and never touches MailKite's internal database. A self-hoster needs exactly two secrets: a MailKite **API key** and a **webhook secret** (`whsec_*`). That portability is the entire point.

### Elevator pitch

> MailKite Mail is an open-source webmail client you can run anywhere — and on anything. It receives mail through a single webhook, stores it in its own database, and sends replies through one API — no IMAP, no POP, no mail server to babysit. One React codebase ships to web, desktop, and mobile as thin clients to a backend you self-host. Point it at a MailKite account and you have a full inbox in minutes.

The market gap it fills is real (see [`../../docs/research/01-market-research.md`](../../docs/research/01-market-research.md)): no one ships a modern, OSI-licensed, framework-native, self-hostable webmail UI. The PHP incumbents (Roundcube, Cypht, SnappyMail) are dated; the modern-stack clients (Zero, Inbox Zero) are Gmail/OAuth-locked; the source-available ones (Forward Email) aren't OSI-licensed. The modern UX exists only inside Google and Microsoft. MailKite Mail is the open, framework-native client that doesn't yet exist — and it's the missing **"see the email"** surface for everyone already receiving MailKite webhooks, on every platform from one codebase.

Taglines we lean on: *"Webmail without a mail server."* · *"Your inbox, your database, one webhook."* · *"One codebase — web, desktop, and mobile."*

---

## 2. Who it's for

| Audience | What they get | Why MailKite Mail fits |
|---|---|---|
| **Self-hosters** (privacy + control) | A real inbox they own end-to-end, on web/desktop/mobile | Only need a MailKite API key + `whsec_*` secret; no IMAP/SMTP infra to run |
| **Developers building on MailKite** | A ready-made UI to browse/search/reply/debug inbound mail | Already receive `email.received` webhooks; stop building ad-hoc dashboards |
| **AI-agent / automation builders** | A human-in-the-loop surface for agent inboxes | Webhook-native ingest + threaded `/v1/send` matches the agent-mail model |
| **Small teams / agencies** | Branded webmail on their own domain, as a real app | The hosted/white-label upsell via [mailn.app](#6-how-it-fits-mailkite); installable PWA + desktop/mobile shells; swappable design tokens |
| **OSS contributors** | A modern reference client to fork | React 19 + Vite + TanStack + shadcn + Tailwind 4 + Hono dual-target + Tauri 2 across desktop/mobile — a project that doesn't exist yet |

---

## 3. Goals

| # | Goal | Why |
|---|---|---|
| 1 | Be a **complete, self-hostable** webmail client | List, read, threads, search, compose/reply/forward, attachments — useful on day one, not a demo |
| 2 | **Receive exclusively via the MailKite webhook** | One ingest seam (`email.received`, HMAC-verified `x-mailkite-signature`); no mail-server complexity for the operator |
| 3 | Keep its **own store**, populated by the webhook | SQLite (Node) / D1 (Workers); never touches MailKite's internal DB — portability is the whole point |
| 4 | **Send/reply only through `/v1/send`** | `inReplyTo` drives RFC5322 `In-Reply-To`/`References`; one outbound path, no SMTP |
| 5 | **Dual-target backend by design** | One Hono app serves the SPA on Workers assets **and** boots on Node — the dual target *is* the install story |
| 6 | **One codebase → web, desktop, and mobile** | One React SPA ships as web + PWA + Tauri 2 desktop + Tauri 2 mobile, all thin clients to the same backend — no per-platform rewrite |
| 7 | **Trivially self-hostable** | A self-hoster needs only a MailKite API key + a webhook secret; minimal config, one command; shells point at a configured backend URL |
| 8 | **Share MailKite's design language** | Lift the framework-agnostic CSS design tokens; feel like part of the platform and make white-label theming "swap the token set" |
| 9 | **Funnel cleanly to the MailKite platform** | The path of least resistance for a backend is MailKite; OSS adoption → hosted/white-label conversions |

---

## 4. Non-goals

These are deliberate simplifications, not missing features. MailKite Mail is a **client**, not a mail **server**, and not a multi-protocol mail app.

| Non-goal | Why | Use instead |
|---|---|---|
| **No IMAP / POP support** | Mail arrives only via webhook into our own store; not a standards-based mail client | The MailKite webhook is the only ingest path |
| **No SMTP receiving / no MX / no mail server** | MailKite's Haraka MX edge owns receiving; the webmail never listens on `:25` | [`../../docs/architecture/mx-edge.md`](../../docs/architecture/mx-edge.md) |
| **No direct SMTP sending** | All outbound is `/v1/send`; no relay, no DKIM/SPF signing inside the webmail | [`../../docs/architecture/outbound-email.md`](../../docs/architecture/outbound-email.md) |
| **Not a provider-agnostic / "any backend" client (v1)** | It is MailKite-coupled by contract; revisit later, don't promise it now | — |
| **Not a native rewrite per platform** | Desktop and mobile are Tauri 2 shells around the *same* React SPA — not separate Swift/Kotlin apps. One codebase, many shells; native code is thin glue (notifications, deep links, keychain) only | [`platforms.md`](platforms.md) |
| **Never accesses MailKite's internal database** | Only the public webhook + JSON/JWT API — a hard boundary that preserves OSS portability | The documented API surface (`api/src/index.ts`) |
| **Not a deliverability / reputation tool** | No warmup, suppression lists, or bounce dashboards — that's the platform's job | The MailKite dashboard |
| **Not the platform admin/console** | It's an end-user inbox, not the customer console (`dashboard/`) or internal admin (`admin/`) | `dashboard/`, `admin/` |
| **No webhook receiver / store on a device** | The desktop/mobile apps are **thin clients**; a device has no public HTTPS URL for `email.received` and must never hold the API key | The server-side backend (`apps/web`'s Hono app) — see [`platforms.md`](platforms.md) |

---

## 5. How the boundary works

Two seams, nothing else crosses the line. Every shell (web, PWA, desktop, mobile) talks to the *same* server-side Hono backend; only the backend holds the API key and runs the webhook receiver + store:

```
  Inbound mail ──► MailKite (Haraka MX → parse/store/route)
                         │
                         │  POST  email.received  (x-mailkite-signature: t=…,v1=…)
                         ▼
                 ┌───────────────────────┐
                 │   MailKite Mail backend│
                 │  Hono app (Node | CF)  │
                 │  ┌──────────────────┐  │
                 │  │  own store        │  │   SQLite (Node) / D1 (Workers)
                 │  │  messages/threads │  │
                 │  └──────────────────┘  │
                 │  /api/* (read) /send   │
                 └───────────┬───────────┘
                             │  /api/* over HTTPS + Bearer JWT
            ┌────────────────┼────────────────┬────────────────┐
            ▼                ▼                ▼                ▼
         Web/PWA          Desktop           Mobile          (all bundle the
        (Hono-served)   (Tauri 2 shell)  (Tauri 2 shell)    SAME React SPA)
                             │
                             │  POST /v1/send  { from, to, subject, inReplyTo… }
                             ▼
                     MailKite (deliverability, DKIM/SPF, threading)
```

- **In:** verify `x-mailkite-signature` with `HMAC-SHA256(webhook_secret, "<t>." + rawBody)` (the Node SDK exposes `MailKite.verifyWebhook(signature, rawBody, secret, toleranceMs)`), then persist the payload into the local store.
- **Out:** `POST /v1/send` with `inReplyTo` to thread replies; MailKite returns `{ id, status }`.
- **Attachments:** signed 7-day URLs (`GET /att/:mid/:idx?exp=…&sig=…`) — no extra auth, render inline.
- **Shells:** desktop/mobile bundle the SPA and call `/api/*` cross-origin against a configured backend URL with a Bearer JWT; the backend's CORS allow-list includes the fixed Tauri origins. See [`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md).

See [`architecture.md`](architecture.md) and [`data-model.md`](data-model.md) for the contracts.

---

## 6. How it fits MailKite

MailKite Mail is the open-source magnet at the top of the MailKite funnel — the same playbook React Email runs for Resend, or "the open-source X" runs for Cal.com, Plausible, and Documenso: lead with a genuinely useful, fully self-hostable product, and let adoption flow into the hosted platform behind it.

The funnel is concrete, not hand-wavy:

1. A developer or self-hoster adopts the OSS webmail → it has to point at a backend → **the easiest backend is MailKite**, because the inbound webhook, `/v1/send`, and signed attachment URLs already match the client's data contract exactly.
2. To receive any mail at all, they need a MailKite account (webhook source + send API). **OSS adoption directly provisions MailKite accounts.**
3. Their inbound/outbound volume meters on MailKite's existing plans → natural expansion.
4. Teams that want branded, run-for-you webmail upgrade to **hosted [mailn.app](https://mailn.app)** + white-label (per-seat, composes with volume plans) — and ship it to their users as web, desktop, and mobile apps from the one codebase.

The brand is **one brand**: "MailKite Mail," with **mailn.app** as the short hosted/login URL. The client is free and portable on purpose — the value and the lock-in are the integrated platform behind it, not the client code. We give the client away generously.

> **Decision (2026-06): brand = "MailKite Mail" (one brand, funnels to the MailKite platform); mailn.app is the short hosted/login URL. Receive mail ONLY via the MailKite webhook; keep our OWN store (SQLite on Node / D1 on Workers); send ONLY via `/v1/send`. The webmail never speaks IMAP/POP/SMTP and never touches MailKite's internal database. Standalone repo `mailkite/mail`, package `@mailkite/mail` — a pnpm + Turborepo workspaces monorepo (`packages/core`, `packages/ui`, `apps/{web,desktop,mobile}`) shipping ONE React UI to web, desktop, and mobile (no native rewrite per platform), all thin clients to the server-side Hono backend. Desktop and mobile are Tauri 2 shells around the same SPA. See [`platforms.md`](platforms.md) and [`repo-structure.md`](repo-structure.md).**

This supersedes the planning stub [`../../docs/plan/05-webmail-oss-and-whitelabel.md`](../../docs/plan/05-webmail-oss-and-whitelabel.md): the OSS→white-label strategy stands, but the "provider-agnostic IMAP/JMAP adapter" framing is narrowed — portability means "a MailKite key + a webhook secret," not "any IMAP backend."

---

## 7. The doc set

| Doc | What it covers |
|---|---|
| [`features.md`](features.md) | The product surface: inbox list, threads, search, compose/reply/forward, attachments, what's in and out for v1 |
| [`platforms.md`](platforms.md) | One React UI, many shells: the thin-client pattern, the four targets (web/PWA/desktop/mobile), why Tauri 2 (vs Electron/Capacitor), the installable PWA + Web Push, per-platform native capabilities (notifications, deep links, keychain, badges, offline cache), and the app-store + signing realities |
| [`repo-structure.md`](repo-structure.md) | The pnpm + Turborepo workspaces monorepo: `packages/core` + `packages/ui` + `apps/{web,desktop,mobile}`, the client/server `exports` split, `turbo.json` task graph, `--filter` workflows, and the 4-artifact build/release/CI matrix |
| [`stack.md`](stack.md) | React + Vite + TanStack Router + shadcn/ui + Tailwind 4, the Hono dual-target (Workers assets + `@hono/node-server`), design tokens |
| [`architecture.md`](architecture.md) | The two seams in detail: webhook receiver, SPA-data endpoints, `/v1/send` outbound, request flow |
| [`data-model.md`](data-model.md) | The own-store schema (messages, threads, attachments) on SQLite/D1 and how webhook payloads map into it |
| [`install.md`](install.md) | Self-host the backend on Node or Workers, the two required secrets (API key + `whsec_*`), one-command setup, hosted mailn.app; shells point at a configured backend URL |

**Related platform docs:** [`../../docs/architecture/00-overview.md`](../../docs/architecture/00-overview.md) · [`../../docs/architecture/outbound-email.md`](../../docs/architecture/outbound-email.md) · [`../../docs/architecture/mx-edge.md`](../../docs/architecture/mx-edge.md) · [`../../docs/architecture/domains.md`](../../docs/architecture/domains.md) · [`../../docs/research/01-market-research.md`](../../docs/research/01-market-research.md)

**Brand & tokens:** design tokens live in [`../../website/src/styles/global.css`](../../website/src/styles/global.css) (lifted verbatim); brand assets in [`../../docs/brand/mark.svg`](../../docs/brand/mark.svg) and [`../../docs/brand/wordmark.svg`](../../docs/brand/wordmark.svg). API surface consumed by the client is defined in `api/src/index.ts`.
