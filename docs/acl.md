# MailKite Mail — access control (ACL)

> **One-liner:** D1/SQLite has **no row-level security**, so we recreate RLS *in code*: a
> **ReBAC-shaped grant model** (owner → team → user, scoped to mailbox **addresses**) evaluated as
> an `EXISTS` predicate that is **injected by one scoped repository** — the only code allowed to
> touch the database. **Deny-by-default**, enforced by a lint that forbids raw DB access elsewhere
> and a negative-test matrix that proves no leak.

Audience and the access tiers are in [`audience.md`](audience.md); the runtime shape is in
[`architecture.md`](architecture.md); the build order is in [`implementation.md`](implementation.md).
This doc is the authoritative access-control design. It **supersedes** the "no per-user ACL,
everyone shares the whole domain" decision in [`teams.md`](teams.md).

## 1. The constraint that drives the design

Postgres apps lean on RLS as a backstop — even a buggy query can't cross a tenant boundary because
the engine appends a mandatory `WHERE`. **D1/SQLite has no `CREATE POLICY`, no session context, no
`SET ROLE`.** There is no database floor.

> Therefore the application layer is the **only** enforcement layer, and the whole game is making it
> impossible for a query to reach the database without being scoped — i.e. manufacturing in code the
> single choke point that RLS gives you in the engine.
> (See OWASP Authorization Cheat Sheet; PlanetScale, Bytebase, Nile on app-layer tenancy.)

## 2. The model — relationships, not roles

The access shape (owner sees *all*, team sees a *subset* of addresses, user sees a *subset/one*) is a
**relationship graph**, not a role table. Per the RBAC→ABAC→ReBAC ladder, plain roles force a "role
per address" explosion; ReBAC (Google Zanzibar / OpenFGA shape) models exactly this:

```
owner  ──owns──▶  domain ──has──▶ address(es)
team   ──member──▶ user
team   ──granted──▶ address          (a team's subset)
user   ──granted──▶ address          (a user's subset, often one)
owner  ──admin──▶  domain            (the "see everything" relation)
```

We borrow ReBAC's **data model** (relation tuples) but keep **evaluation in-process** as SQL against
the same D1 — **no OpenFGA/SpiceDB service, no network hop, no second source of truth.** The "graph"
is two small tables; "can this actor see this message?" is one `EXISTS`.

**Resource = the mailbox address.** Messages already carry their receiving address (`messages.to_addr`
today). Access is decided entirely by *which addresses a principal is granted*; a message is visible
iff its address is. (Message- or label-level grants are a deliberate future refinement — §9.)

**One deployment = one domain.** The webmail serves a single domain's mail, so we don't carry a
`domain_id` everywhere — the **owner/admin** relation is simply "sees every address," and grants are
domain-local by construction. (Multi-domain is a platform concern, not V1.)

## 3. Principals and the Actor

| Principal | Source | Authority |
|---|---|---|
| **Owner / admin** | `users.role = 'admin'` | Every address (the modeled `admin` relation — not a code bypass). |
| **Member** | `users.role = 'member'` | Only addresses granted directly or via a team. |
| **API key** (later) | a scoped key row | Same grant model as a member; scope resolved from the key, never the request. |

The **Actor** is the request-scoped capability the gateway runs every query against:

```ts
interface Actor {
  userId: string
  isAdmin: boolean   // the owner/admin relation → sees all addresses
}
```

> **The Actor is built server-side ONLY**, from the authenticated session (or API key) at the request
> boundary — **never** from a header/body/query param. (The OneUptime CVE GHSA-r5v6-2599-9g3m was
> exactly a client-controlled scope flag → cross-tenant takeover. We hard-rule it out.)

## 4. Schema (additive over the current model)

```sql
-- The resource: mailbox addresses on the domain (support@, alice@, …).
CREATE TABLE addresses (
  id         TEXT PRIMARY KEY,            -- adr_*
  address    TEXT NOT NULL UNIQUE,        -- full address, lowercased
  label      TEXT,
  created_at INTEGER NOT NULL
);

-- Teams: named groups the owner creates.
CREATE TABLE teams (
  id         TEXT PRIMARY KEY,            -- tm_*
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role    TEXT NOT NULL DEFAULT 'member', -- 'admin' (manage this team) | 'member'
  PRIMARY KEY (team_id, user_id)
);

-- The grant tuple: who may access an address. Subject is EITHER a user OR a team.
CREATE TABLE address_grants (
  address_id TEXT NOT NULL REFERENCES addresses(id),
  user_id    TEXT REFERENCES users(id),
  team_id    TEXT REFERENCES teams(id),
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (team_id IS NOT NULL)),
  UNIQUE (address_id, user_id, team_id)
);
CREATE INDEX idx_grants_user ON address_grants(user_id);
CREATE INDEX idx_grants_team ON address_grants(team_id);

-- messages gains a stable address_id (backfilled from to_addr) so grants join cleanly.
ALTER TABLE messages ADD COLUMN address_id TEXT REFERENCES addresses(id);
CREATE INDEX idx_messages_address ON messages(address_id, received_at DESC);
```

This is a flattened Zanzibar tuple set: `address_grants` ≈ `(object=address, relation=reader,
subject=user | team#member)`; `team_members` is the `team#member` userset; `users.role='admin'` is
the wildcard relation.

## 5. The scope predicate (this is the RLS we don't have)

One builder turns an `Actor` into a SQL fragment + bindings. It is the **single source of authority**;
every read, write, and **aggregate** pastes it into its `WHERE`.

```ts
// admin: no filter (every address). member: only granted addresses, via the EXISTS subquery.
function scopePredicate(actor: Actor): { sql: string; params: unknown[] } {
  if (actor.isAdmin) return { sql: '1=1', params: [] }
  return {
    sql: `EXISTS (
      SELECT 1 FROM address_grants g
      LEFT JOIN team_members tm ON tm.team_id = g.team_id
      WHERE g.address_id = messages.address_id
        AND (g.user_id = ? OR tm.user_id = ?)
    )`,
    params: [actor.userId, actor.userId],
  }
}
```

- **Deny-by-default falls out for free:** a member with no grants matches no `EXISTS` row → **zero
  results**, never an unfiltered dump. (An empty scope is `WHERE <false>`, not "no filter".)
- **Admin is a modeled relation,** not a special branch that skips ACL — it's "the predicate that
  matches every address," and on a single-domain deploy that's `1=1`.

Default to this **EXISTS predicate** (always-current, no staleness, no `IN (…)`-list ceiling). Two
sanctioned optimizations behind the *same builder* (so they can't diverge): the **admin fast path**
(`1=1`), and, later, **precomputing the granted `address_id` set** once per request for an API-key
actor with short-TTL caching.

## 6. The choke point — one scoped repository

`MailRepo` is already the only data-access layer; we **harden** it from "a repository you pass a
userId to" into "a repository that *cannot be called without an Actor* and injects the predicate
itself." This is the upgrade over `email/api`'s `makeRepo`, where scoping is per-route discipline with
**no failsafe** (`getMessage(id)` there has no ownership filter — a forgetful handler leaks).

The contract:

1. **The D1 binding is referenced in exactly one module.** Nothing else may `prepare`/`exec`.
2. **Every read/write method takes a non-optional `Actor`** and applies `scopePredicate(actor)` —
   callers cannot opt out. `listMessages(actor, …)`, `getMessage(actor, id)`, `updateFlags(actor,
   id, …)`, `retryDelivery(actor, id)`, **and** any `count`/aggregate.
3. **Per-object, not per-type.** A single-message fetch still runs through `… AND <scope>` — never
   "load by id, then check in the handler." (Closes IDOR.)
4. **Deny-by-default.** Insufficient scope ⇒ empty/0 rows ⇒ `404`, identical to "doesn't exist."

```ts
// before (leaky): returns everything, handler must remember to filter
async listMessages(opts): Promise<MessageRow[]>

// after (scoped): the predicate is mandatory and internal
async listMessages(actor: Actor, opts): Promise<MessageRow[]> {
  const { sql, params } = scopePredicate(actor)
  return this.sql.all(
    `SELECT * FROM messages WHERE ${sql} AND archived = 0
     ORDER BY received_at DESC LIMIT ?`, [...params, opts.limit ?? 100])
}
```

## 7. Pitfalls (where no-RLS apps actually leak)

- **Raw queries escaping the gateway** — the #1 failure. Mitigation: module boundary + lint (§8).
- **JOIN leakage** — joining `messages` to an *unscoped* child (attachments, headers) re-exposes
  hidden rows. **Rule: the scope is applied to the driving table (`messages.address_id`); child
  tables are reached only *through* the scoped parent, never as independent entry points.**
- **Aggregate / count / existence leaks** — `COUNT(*)`, `EXISTS`, "address already has mail",
  404-vs-403 timing, `INSERT … ON CONFLICT` can reveal *existence* outside scope even when bodies are
  hidden. **Rule: aggregates run over the same predicate as reads. No "global count" helper.**
- **Client-controlled scope** — the Actor is built only from the authenticated principal, server-side.
- **Write-path forgery** — scoping reads but not writes lets an actor `UPDATE`/`DELETE` out of scope.
  Every mutating method carries the predicate too (affects 0 rows out of scope).

## 8. Assurance — proving no leak (all three required)

1. **The lint is the keystone.** The choke point is only real if mechanically enforced:
   - ESLint `no-restricted-properties`/`import/no-restricted-paths` forbidding `.prepare(`/`.exec(`/
     the D1 binding anywhere except `packages/core/src/server/repo.ts`; a CI grep gate
     (`rg '\.prepare\(' --glob '!**/repo.ts'` must be empty); the raw `D1Database` type is wrapped so
     only the scoped repo is exported.
2. **Negative-test matrix** (deny-by-default proof), per resource type:
   - member **cannot** read a message on a non-granted address — list, single-`getById`, search,
     **and count**;
   - team member sees exactly the team's subset, no more;
   - admin sees all addresses; a **no-grants** actor gets `[]` (the `1=0` behavior), never a dump;
   - **write negatives:** flag/retry/delete on an out-of-scope id affects 0 rows;
   - **forged-scope:** a scope supplied via header/body is ignored (regression guard for the
     OneUptime CVE class).
3. **Gateway contract test** — reflect over every exported repo method and assert each requires an
   `Actor`. A new method without a scope param fails the test, so "every query is scoped" is a typed,
   tested invariant, not developer discipline.

## 9. Rollout & deferred

- **V1:** addresses + teams + `address_grants` + admin/member; the scoped `MailRepo` + predicate +
  lint + negative tests. Owner grants addresses to teams and users; everyone sees exactly their slice.
- **Team-admin tier:** `team_members.role = 'admin'` lets a member manage *their* team's membership
  (not create teams or touch other teams). Ships once basic grants are solid.
- **Deferred:** API-key principals (same model, precomputed scope); **message/label-level** grants;
  multi-domain in one deployment; time-boxed / least-privilege grant expiry.

**One-line takeaway:** *no RLS in D1 → rebuild it in code — a ReBAC-shaped grant graph evaluated as
an `EXISTS` predicate, injected by the one repository allowed to touch the database, deny-by-default,
lint- and negative-test-enforced so no query can escape its scope.*

## Sources

OWASP Authorization Cheat Sheet · PlanetScale "Approaches to tenancy in Postgres" · Bytebase "Postgres
RLS limitations and alternatives" · Nile multi-tenant RLS · OneUptime RLS guide + CVE
GHSA-r5v6-2599-9g3m · Querio "RLS for multi-tenant analytics" (aggregate leaks) · Oso ReBAC academy ·
AuthZed Zanzibar · OpenFGA authorization concepts · Auth0 FGA Permissions Index · AWS "Fine-grained
authorization at scale" · Mergify "Application vs Database permissions".
