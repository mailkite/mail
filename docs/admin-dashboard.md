# MailKite Mail — Admin & Setup dashboard

> **One-liner:** A self-hostable webmail needs an **admin-only** place to configure it. MailKite
> Mail has two **roles** (`admin`, `user`); the admin gets a **Settings / Setup** dashboard that
> surfaces every config item's status (set-via-env / saved / missing), accepts the inputs a deploy
> needs, and gates each feature on whether its key is present. Identical on Cloudflare Workers and
> a Node/VPS host.

See [`architecture.md`](architecture.md) (auth), [`data-model.md`](data-model.md) (settings/users),
[`install.md`](install.md) (env), [`implementation.md`](implementation.md) (Phase 4.5).

## 1. Roles

| Role | Can do |
|---|---|
| **admin** | Everything a user can, **plus** the Settings/Setup dashboard, config, and (multi-user) user management |
| **user** | Read/compose/organize their mail only — no dashboard |

`users.role ∈ {admin, user}`. A self-hoster running solo is the single admin. The session carries
the role; **`requireAdmin` gates `/api/admin/*` and the `/settings` route** — a non-admin hitting
either gets `403` (API) or a redirect (UI). This is the one hard rule: **only an admin reaches the
dashboard.**

## 2. Bootstrapping the admin

1. **`ADMIN_PASSWORD` env set** → an `admin@<host>` (or `ADMIN_EMAIL`) admin exists from first boot.
2. **No `ADMIN_PASSWORD`** → first run shows a **Setup wizard**: create the admin (password hashed
   into `settings`/`users`). Until an admin exists, the app is locked to the wizard.

Sessions are signed with `SESSION_SECRET` (auto-generated + saved if unset).

## 3. Config surfacing & resolution

The dashboard's **Settings** page lists every config item with a status badge:

| Item | Env var | Secret? | Gates |
|---|---|---|---|
| MailKite API key | `MAILKITE_API_KEY` | yes | sending/replies |
| Webhook secret | `MAILKITE_WEBHOOK_SECRET` | yes | inbound ingest |
| API base | `MAILKITE_API_BASE` | no | — |
| From address | `MAILKITE_FROM` | no | sending identity |
| Web Push (VAPID) | `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | yes | push (Phase 6) |

**Resolution order:** `env var → saved DB setting → unset`.
- Platform secrets (Workers `wrangler secret put`, VPS env) **always win** — the UI can't override them.
- Items not in env can be **saved** via the dashboard into the `settings` table (for operators
  without shell access). Secrets are write-only in the UI (shown masked, e.g. `mk_•••••3f9`).
- **Unset → the feature disables** (see Capabilities).

## 4. Capabilities (the disable-when-no-key rule)

`GET /api/config` returns booleans computed from resolved config:

```jsonc
{ "sending": true, "push": false, "needsSetup": false }
```

The SPA reads it once and **disables** what isn't configured — Compose/Reply are hidden when
`sending` is false, the push toggle is hidden when `push` is false, and the whole app routes to the
wizard when `needsSetup` is true. The backend **also** enforces it (e.g. `/api/send` → `503` when
no API key), so the gate isn't UI-only.

## 5. Routes

| Route | Access | Purpose |
|---|---|---|
| `GET /api/config` | authed | capabilities for the SPA |
| `POST /api/admin/login` · `POST /api/admin/setup` | public (setup until admin exists) | auth / first-run |
| `GET /api/admin/config` | **admin** | full config status (masked) |
| `POST /api/admin/config` | **admin** | save settings |
| `GET /api/admin/users` · `POST …` | **admin** | (multi-user) manage users |
| `/settings` (SPA) | **admin** | the dashboard UI |

## 6. Deploy parity (Workers + VPS)

Both targets read the same resolved config; only the *source* differs:

| | Cloudflare Workers | Node / VPS |
|---|---|---|
| Secrets | `wrangler secret put MAILKITE_API_KEY` … | `.env` / process env |
| Saved settings | D1 `settings` table | SQLite `settings` table |
| Admin dashboard | identical | identical |

> **Decision (2026-06):** config is **env-first with a DB-saved fallback**, surfaced and editable
> only through an **admin-gated** dashboard, with every key-dependent feature **disabled when its
> key is absent**. This lets any developer deploy on their platform of choice and finish setup from
> the UI, while platform secrets stay authoritative.
