# MailKite Mail — Auth & sessions (as built)

> **One-liner:** MailKite Mail authenticates with **HTTP-only, HMAC-signed session cookies**, not
> Bearer JWTs. Passwords are **PBKDF2-SHA256** hashes in the own store; sessions are a signed
> `base64(json).hmac` token in the `mk_session` cookie; two middlewares — `requireAuth` and
> `requireAdmin` — gate the API. Every primitive is **Web Crypto**, so the exact same code runs on
> Node (VPS) and Cloudflare Workers.

This is the authoritative description of what's implemented. Where it disagrees with the
Bearer-JWT language in [`architecture.md`](architecture.md) / [`00-overview.md`](00-overview.md),
**this doc wins** — the shipped model is cookie sessions. Roles and the admin gate are specced in
[`admin-dashboard.md`](admin-dashboard.md); the build sequencing is [`implementation.md`](implementation.md)
(Phases 2 + 4.5).

## 1. Where the code lives

| Piece | File |
|---|---|
| Isomorphic primitives (hash / verify / sign / verify session) | `packages/core/src/server/auth.ts` |
| `users` + `settings` tables | `packages/core/src/server/schema.ts` |
| Repo methods (`createUser`, `getUserByEmail`, `countUsers`, get/set setting) | `packages/core/src/server/repo.ts` |
| Cookie wiring, middleware, endpoints | `apps/web/src/app.ts` |
| `SESSION_SECRET` bootstrap | `apps/web/src/node.ts` |
| Tests | `packages/core/test/auth.test.ts`, `apps/web/test/admin.test.ts` |

## 2. Primitives (`@mailkite/core/server`)

All four are pure Web Crypto — no Node `crypto` module, no deps — so they run unchanged on Workers.

| Export | Shape | Notes |
|---|---|---|
| `hashPassword(pw)` | → `pbkdf2$<iter>$<b64 salt>$<b64 hash>` | PBKDF2-SHA256, **100 000** iterations, random 16-byte salt, 256-bit derived key |
| `verifyPassword(pw, stored)` | → `boolean` | Re-derives with the stored salt/iterations and compares |
| `signSession(payload, secret)` | → `<base64(json)>.<hmac-hex>` | HMAC-SHA256 over the base64 body |
| `verifySession(token, secret)` | → `SessionPayload \| null` | Recomputes the HMAC, then checks `exp`; any failure → `null` |

`SessionPayload = { uid, role: 'admin' | 'user', email, exp }`.

> **Note:** the session token is signed (tamper-evident) but **not encrypted** — the JSON body is
> readable. It carries no secret, only `uid`/`role`/`email`/`exp`, so that's fine; never put a secret
> in the payload.

## 3. The cookie

`startSession()` in `app.ts` issues the cookie after setup/login:

| Attribute | Value | Why |
|---|---|---|
| name | `mk_session` | — |
| `httpOnly` | `true` | JS can't read it (XSS can't exfiltrate the session) |
| `sameSite` | `Lax` | CSRF mitigation; top-level navigations still send it |
| `secure` | `true` when the request URL is `https://` | Set over TLS, omitted on local `http://` dev |
| `path` | `/` | Whole app |
| `maxAge` / `exp` | **7 days** (`SESSION_TTL`) | Cookie expiry and the signed `exp` match |

`logout` calls `deleteCookie`. There is no server-side session store — expiry is entirely in the
signed `exp`, so logout is best-effort client-side (the token stays valid until `exp`; rotate
`SESSION_SECRET` to hard-invalidate all sessions).

## 4. Middleware

```
requireAuth   → 401 if no/invalid session;       sets c.var.user, calls next()
requireAdmin  → 401 if no session, 403 if role≠admin; sets c.var.user, calls next()
```

Typed via `Hono<{ Variables: { user: SessionPayload } }>` so `c.get('user')` is typed downstream.

| Route group | Guard |
|---|---|
| `/api/health`, `/api/config` | public (capabilities the SPA needs pre-login) |
| `/api/admin/setup`, `/api/admin/login` | public (setup is only reachable until an admin exists) |
| `/webhook` | **HMAC** (`x-mailkite-signature`) — never session-gated |
| `/api/messages*`, `/api/send`, `/api/admin/me` | `requireAuth` |
| `/api/admin/config` (GET/POST) | `requireAdmin` |

The webhook and the read/reply API are deliberately separate trust domains: inbound is HMAC-only,
the app API is session-only. Neither accepts the other's credential.

## 5. Endpoints

| Method · Path | Access | Body / effect |
|---|---|---|
| `POST /api/admin/setup` | public until an admin exists (else `409`) | `{email, password}` → creates the first **admin** (hashed), starts a session, `201` |
| `POST /api/admin/login` | public | `{email, password}` → session on success, `401` on bad creds |
| `POST /api/admin/logout` | any | clears `mk_session` |
| `GET /api/admin/me` | `requireAuth` | `{email, role}` for the current session |
| `GET /api/admin/config` | `requireAdmin` | per-key config status, secrets masked |
| `POST /api/admin/config` | `requireAdmin` | `{key, value}` → save to `settings` (rejects unknown keys) |

## 6. Bootstrapping the first admin

Two mutually exclusive paths (see [`admin-dashboard.md`](admin-dashboard.md) §2):

1. **`ADMIN_PASSWORD` env set** → login accepts `ADMIN_EMAIL` (default `admin`) + `ADMIN_PASSWORD`
   directly, issuing a session with a synthetic `uid: 'env-admin'`. No `users` row needed. This is
   the zero-DB-write path for a platform secret.
2. **No `ADMIN_PASSWORD`** → `GET /api/config` reports `needsSetup: true` while `countUsers() === 0`;
   the SPA routes to the **setup wizard**, which `POST /api/admin/setup` to create a hashed admin in
   `users`. Once any user exists, setup returns `409`.

## 7. `SESSION_SECRET`

Resolved in `node.ts` as **env → saved setting → generated**:

- `SESSION_SECRET` env wins.
- else a value previously saved in `settings` is reused (so restarts don't log everyone out).
- else a fresh secret is generated **and persisted** to `settings`, with a warning to set the env
  for production.

On Workers the secret comes from `wrangler secret put SESSION_SECRET` (or the same DB fallback).
**Rotating it invalidates every existing session** — the only way to force a global logout.

## 8. Divergence from the design docs

[`architecture.md`](architecture.md) and [`00-overview.md`](00-overview.md) describe a **Bearer
JWT** carried cross-origin by the Tauri shells. The shipped web/Node/Workers build uses
**same-origin HTTP-only session cookies** instead — simpler, XSS-safer, no token storage in the
client. When the desktop/mobile shells (Phases 7–8) need cross-origin auth, revisit this: either a
cookie with the shell's fixed origin in a CORS allow-list, or a bearer token minted from the same
`signSession` primitive. Until then, cookies are the whole story.
