# MailKite Mail — access architecture (the choke point)

> **One-liner:** Every request resolves to an **Actor** (built server-side from the session/API key),
> and **every database call** for mail goes through **one scoped repository** that injects the
> [ACL](acl.md) predicate before touching D1. There is exactly **one** place that can read or write
> the store, and it is **physically incapable of running an unscoped query**. This is how a database
> with no row-level security still guarantees isolation.

This is the runtime companion to [`acl.md`](acl.md) (the model) and [`audience.md`](audience.md) (the
tiers). It updates the auth/data sections of the legacy [`architecture.md`](architecture.md) for the
2026-06 owner→team→user pivot.

## 1. The shape

```
                        ┌───────────────────────────── one Worker ─────────────────────────────┐
  inbound mail          │                                                                       │
  (MailKite webhook) ──▶│  POST /webhook  ── HMAC verify ──▶  ingest: resolve address_id ──┐    │
                        │                                                                  │    │
  browser / SDK / MCP   │  /api/* ── auth ──▶ Actor{userId,isAdmin} ──▶  ┌───────────────┐ │    │
  (session / API key) ─▶│                                               │  MailRepo      │◀┘    │
                        │                                               │ (THE choke pt) │      │
                        │   no other code may touch the DB  ───────────▶│  scopePredicate│──▶ D1 / R2
                        │                                               └───────────────┘      │
                        └───────────────────────────────────────────────────────────────────────┘
```

Two trust domains feed the same store, exactly as today:
- **`/webhook`** — HMAC-verified, not session-authed. Ingests mail and assigns each message its
  `address_id` (the ACL anchor). It writes; it is never scoped by an Actor (it's the system).
- **`/api/*`** — session- or API-key-authed. Reads/writes go **only** through the scoped `MailRepo`.

## 2. Request → Actor (the boundary)

Auth middleware turns a credential into an `Actor` and nothing else may. The Actor is the *only* input
to scoping, and it is **derived entirely server-side** (session cookie or `mk_…` key) — never from a
header, body, or query param.

```
requireAuth:  session/key → users row → Actor{ userId, isAdmin: role === 'admin' }
              attaches Actor to the request context; no DB read happens without it
```

`isAdmin` is the modeled "owner sees everything" relation (see [`acl.md`](acl.md) §3), not a code
path that skips ACL.

## 3. The choke point (`MailRepo`)

`MailRepo` is already the single data-access layer; the pivot **hardens** it so scope is mandatory and
internal — the upgrade over `email/api`'s `makeRepo`, where query scoping is per-route discipline with
no failsafe.

| Property | Guarantee |
|---|---|
| **Single DB owner** | The D1 binding is referenced in `packages/core/src/server/repo.ts` and nowhere else (lint-enforced). |
| **Mandatory Actor** | Every read/write/aggregate method's first arg is `Actor`; it calls `scopePredicate(actor)` and pastes it into the `WHERE`. No bypass. |
| **Deny-by-default** | Insufficient scope ⇒ 0 rows ⇒ `404` (indistinguishable from "not found"). |
| **Per-object** | `getMessage(actor, id)` is itself scoped — no "fetch then check" in handlers (closes IDOR). |
| **JOIN-safe** | Child tables (attachments/headers) are reached through the scoped `messages` driver only. |

The endpoint layer becomes thin: `app.ts` resolves the Actor in middleware and passes it to repo
calls; it carries **no** authorization logic of its own (no `.filter()` after fetch). All enforcement
lives in the one predicate.

## 4. Ingest assigns the ACL anchor

The webhook handler maps each delivery's recipient to an `addresses` row and stamps
`messages.address_id`. New recipient addresses are auto-created (or, optionally, dropped if the domain
owner restricts to provisioned addresses). After ingest, a message's visibility is fully determined by
grants on its address — the read path never re-parses `to_addr`.

```
/webhook → verify → parse to_addr → upsert addresses(address) → insert messages(..., address_id)
```

Backfill: a migration creates `addresses` from existing `messages.to_addr` and sets each message's
`address_id` so the predicate joins cleanly from day one.

## 5. What changes vs. what doesn't

| | Before (team, shared) | After (scoped) |
|---|---|---|
| Read API | `listMessages()` returns all domain mail | `listMessages(actor)` returns only the actor's addresses |
| Authorization | none (everyone saw everything) | one predicate in the repo, deny-by-default |
| New tables | — | `addresses`, `teams`, `team_members`, `address_grants` |
| Admin surface | invite members | + create teams, grant addresses to teams/users |
| Deployment | Workers + D1 + R2, single domain | **unchanged** |
| Choke point | `MailRepo` (unscoped) | `MailRepo` (scoped, lint-enforced) |

Identity/auth (email-code + Google OAuth, first-user-admin) and the Workers/D1/R2 deploy target are
**unchanged** — see [`auth.md`](auth.md) and [`deploy.md`](deploy.md). This pivot is additive: a
grant model + a hardened gateway, not a rewrite.

## 6. Failure modes the architecture forecloses

- A handler that forgets to filter → **impossible**: there is no unscoped read method to call.
- A new query added in a new file → **caught by lint** (only the repo may touch the DB).
- An IDOR by guessing a message id → **404**, because `getMessage` is itself scoped.
- A count/search that leaks existence → the **same predicate** governs aggregates and search.
- A client trying to widen its own scope → the Actor ignores all client input.

See [`acl.md`](acl.md) §7–§8 for the full pitfall list and the negative-test matrix that proves each
of these.
