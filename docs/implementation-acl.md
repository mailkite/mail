# MailKite Mail — implementation plan: scoped access (owner → team → user)

> **One-liner:** The build order for the pivot from shared-domain team mail to **tiered, scoped
> access** — owner sees all, teams see a subset of addresses, users see a subset/one. Each phase is a
> runnable vertical slice; the **enforcement phase (A1) ships before any UI**, so isolation is never
> "added later." Model is [`acl.md`](acl.md), runtime is [`access-architecture.md`](access-architecture.md),
> audience is [`audience.md`](audience.md).

This is the implementation doc for the access pivot. It builds on the shipped team app (see
[`implementation.md`](implementation.md) phases T1–T4) and **reverses** the "no per-user ACL" decision
in [`teams.md`](teams.md).

## Status (live)

`✅ done` · `🚧 in progress` · `⬜ not started` — updated as phases land.

| Phase | Status |
|---|---|
| A0 — Schema + backfill | ✅ |
| A1 — Enforcement core (scoped repo + lint + negatives) | ✅ |
| A2 — Ingest anchor | ✅ |
| A3 — Admin: addresses/teams/grants | ✅ |
| A4 — Onboarding & open registration | ⬜ |
| A5 — Scoped API + UI | ⬜ |
| A6 — Team-admin tier *(optional)* | ⬜ |

## Principles

- **Enforcement first.** The scoped repository + predicate + lint + negative tests (A1) land before
  any grant UI. We never have a window where mail is readable cross-scope.
- **One choke point.** All enforcement is the single predicate in `MailRepo`; phases add data and UI
  around it, never new authorization logic.
- **Additive, not a rewrite.** Identity (email-code + Google OAuth, first-user-admin) and the
  Workers/D1/R2 deploy are unchanged. We add tables + a hardened gateway.
- **Deny-by-default at every step.** A half-built phase fails closed (empty results), never open.

## Phases at a glance

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| **A0** | Schema + backfill | `addresses`, `address_id` on messages, `teams`, `team_members`, `address_grants`; migration + backfill from `to_addr` | T-series |
| **A1** | Enforcement core | `Actor`, `scopePredicate`, **scoped `MailRepo`**, the lint, the contract test + negative-test matrix | A0 |
| **A2** | Ingest anchor | webhook assigns `address_id` (auto-create addresses) | A0 |
| **A3** | Admin: addresses/teams/grants | owner provisions addresses, creates teams, grants to teams/users | A1 |
| **A4** | Onboarding & open registration | self-serve register → first-admin / invited / claim-personal / invite-only; the `OPEN_REGISTRATION` toggle | A0, A1 |
| **A5** | Scoped API + UI | every `/api/*` mail route is Actor-scoped; UI shows only the actor's addresses; compose from granted | A1–A4 |
| **A6** | Team-admin tier *(optional)* | `team_members.role='admin'` manages own team's membership | A3 |

Critical path: **A0 → A1** (the floor), then A2/A3/A4 in parallel, A5 after, A6 last.

## Phase detail

### A0 — Schema + backfill
- Migration: `addresses`, `teams`, `team_members`, `address_grants` (the [`acl.md`](acl.md) §4 schema);
  `ALTER TABLE messages ADD COLUMN address_id` + index.
- **Backfill**: create an `addresses` row per distinct `messages.to_addr`; set each message's
  `address_id`. Keep `SCHEMA_SQL` and the D1 migration in lockstep (the `migration-drift` test).
- **Exit:** fresh + migrated DBs match; every existing message has an `address_id`.

### A1 — Enforcement core (the floor)
- `Actor { userId, isAdmin }`, built only in auth middleware (server-side).
- `scopePredicate(actor)` — admin ⇒ `1=1`; member ⇒ the `EXISTS` grant subquery.
- **Harden `MailRepo`**: every read/write/aggregate takes `Actor` and injects the predicate;
  delete the unscoped `listMessages()`/`getMessage(id)` signatures.
- **The lint**: forbid `.prepare(`/`.exec(`/the D1 binding outside `repo.ts` (ESLint rule + CI grep
  gate). **The contract test**: reflect over repo methods, assert each requires an `Actor`.
- **Negative-test matrix** ([`acl.md`](acl.md) §8): member can't read/list/search/**count** a
  non-granted address; no-grants actor gets `[]`; write-path negatives; forged-scope ignored;
  admin sees all.
- **Exit:** lint + contract + negatives all green; no unscoped query exists in the codebase.

### A2 — Ingest assigns the anchor
- Webhook ingest upserts `addresses(address)` from the recipient and stamps `messages.address_id`.
- Owner option: auto-create on first receipt **or** restrict to provisioned addresses (drop others).
- **Exit:** new inbound mail lands with a valid `address_id`; the read path never re-parses `to_addr`.

### A3 — Admin: addresses, teams, grants
- Endpoints (admin-only): CRUD `addresses`, `teams`, `team_members`; grant/revoke `address_grants`
  (address → user or team).
- Settings UI: an **Access** section — provision addresses, create teams, drag/assign grants, see
  "who can see what."
- **Exit:** owner can grant `support@` to the *Support* team and `alice@` to one user; revocation
  removes access immediately (the predicate reads grants live).

### A4 — Onboarding & open registration
Self-serve registration (Google OAuth, or email + password + code) branches on state — replacing the
team app's flat "uninvited → 403" gate ([`acl.md`](acl.md) §9, [`audience.md`](audience.md) Onboarding):
- **No users yet** → first user becomes **admin** (unchanged).
- **Email was invited** → activate as a member with the invite's grants (unchanged).
- **Not invited + `OPEN_REGISTRATION` on + address free** → **claim a personal mailbox**: the
  registrant picks an available `you@domain`; create the `addresses` row + a direct
  `address_grants(address ← user)`. (Availability check = no existing `addresses` row; reserve common
  system localparts like `admin@`, `postmaster@`.)
- **Not invited + `OPEN_REGISTRATION` off** → reject ("invite-only — ask the domain owner").
- Add the `OPEN_REGISTRATION` admin toggle (Settings) + `/api/registration/check?address=` availability
  endpoint for the claim UI.
- **Exit:** with open registration on, a stranger registers, claims a free address, and sees **only**
  that mailbox; with it off, an uninvited registration is refused; first-user-admin and invite paths
  still work.

### A5 — Scoped API + UI
- Every mail route (`/api/messages`, `/api/messages/:id`, flags, search, `/api/identities`,
  `/api/send`) passes the `Actor`; the repo scopes. Compose "From" offers only **granted** addresses.
- UI: a member sees only their addresses/threads; counts and search respect scope; no cross-scope
  affordances rendered.
- **Exit:** logged in as a scoped member, the inbox, search, counts, and send are limited to granted
  addresses — verified against the A1 negatives end-to-end.

### A6 — Team-admin tier *(optional)*
- `team_members.role='admin'` may add/remove members of **their** team only (not create teams or
  touch other teams). A scoped slice of the admin surface.
- **Exit:** a team-admin manages their team; cannot widen their own grants or reach other teams.

## Rollout & migration notes

- **Order matters:** deploy A0 (migration) before A1 code, exactly as the team migrations were applied
  before their code (see [`deploy.md`](deploy.md)).
- **The current admin (`bucabay@…`) stays `admin`** → sees all addresses (the owner). Existing members
  start with **no grants** (deny-by-default) until the owner grants them — a deliberate, safe default;
  the owner re-grants intentionally.
- **No data loss:** the pivot only adds tables/columns and tightens reads; messages and attachments
  are untouched.
