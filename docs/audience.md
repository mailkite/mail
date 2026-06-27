# MailKite Mail — target audience

> **One-liner:** MailKite Mail is **domain-owner-first.** The **person who controls a domain** — a
> developer, indie maker, agency, or website owner — reads and routes their domain's mail and
> **delegates scoped access** to teams and users. Access is **tiered**: the owner sees **all** mail;
> a team sees a **subset** of mailbox addresses; a user sees a **subset, or a single** address.
> When the owner **enables open registration**, consumers can also **self-serve a personal mailbox**
> on the domain — an available address of their choice — so the same app serves both *delegated team
> mail* and *personal mailboxes*.

This supersedes the "team email over a shared domain, no per-user ACL" framing in
[`teams.md`](teams.md). The ACL model is in [`acl.md`](acl.md), the runtime in
[`access-architecture.md`](access-architecture.md), and the build order in
[`implementation-acl.md`](implementation-acl.md).

## 1. Who it's for

| Persona | Who they are | What they get |
|---|---|---|
| **Domain owner / maker** | The first user — controls the domain (DNS + the MailKite webhook). The buyer and the super-admin. | **All mail** on the domain. Provisions addresses, creates teams, invites users, grants access, toggles open registration, configures the app. |
| **Team member** | An individual **invited to a team** — e.g. *Support*, *Sales* — granted that team's **set of addresses**. | The mail for **the team's addresses** (e.g. `support@`, `help@`). Sends as any of those. |
| **End user** | An individual **invited directly** to specific address(es) — a contractor, a client. | The mail for **the address(es) granted to them** — often **just one** (e.g. `alice@`). |
| **Personal-mailbox owner (consumer)** | Someone who **self-serve registers** when open registration is enabled and **claims an available address**. | Their **own** mailbox (the address they claimed). Nothing else — until an admin/team invites them to a team. |

The unifying idea: **the owner holds the domain; everyone else holds a slice of it** — delegated by
an admin, or self-claimed as a personal mailbox when the owner allows it.

## Onboarding — how you get in

Registration is **self-serve** (Google OAuth, or email + password with a one-time code). What you get
depends on the state of the deployment:

1. **No users yet → you become the admin.** The first person to register owns the domain (sees all).
2. **You were invited → you join with your grants.** If an admin or team admin invited your email,
   registering activates you with the **team / address access** you were invited to.
3. **Not invited, open registration ON → claim a personal mailbox.** Pick an **available** address
   (`you@domain`); it becomes your personal mailbox (a direct grant to that one address). An admin or
   team can later invite you to a team for more access.
4. **Not invited, open registration OFF → invite-only.** Registration is refused with "ask the domain
   owner to invite you."

> **"If it's available (enabled)"** = two gates: the owner has **enabled open registration**, *and* the
> **address you pick is free**. Both must hold to self-serve a personal mailbox. Either way, what you
> can see is still the [ACL](acl.md) grant set for your addresses — personal claim just creates a
> direct grant to the one address you chose.

## 2. Why this audience

- **The domain controller is the real customer.** Whoever owns the DNS and points the webhook is who
  pays and who decides. Consumer webmail competes with Gmail; *domain mail control + delegation* does not.
- **Delegation is the product.** A maker running `acme.com` wants `support@` to go to a support
  contractor, `billing@` to the bookkeeper, and to keep everything else private. That's a scoped-ACL
  problem, not an inbox problem — and it's what this app does that Gmail/Workspace make heavy.
- **Developers extend it.** The same audience already uses the MailKite API/SDKs/MCP. The webmail is
  the human surface over the same store; the owner can mix programmatic routing with delegated human
  inboxes.

## 3. What each persona can do

| Capability | Owner | Team member | End user | Personal owner |
|---|---|---|---|---|
| Read mail for **all** addresses | ✅ | — | — | — |
| Read mail for **granted** addresses | ✅ | ✅ | ✅ | ✅ (their one) |
| Send as a **granted** address | ✅ | ✅ | ✅ | ✅ |
| **Self-register + claim** an available address | — | — | — | ✅ (when open registration on) |
| Provision/assign addresses to others | ✅ | — | — | — |
| Create teams / grant access | ✅ | (team-admin: within team) | — | — |
| Invite users to teams | ✅ | (team-admin) | — | — |
| Toggle open registration | ✅ | — | — | — |
| Configure the app (keys, branding) | ✅ | — | — | — |

A **team-admin** is an optional middle tier (a member who can manage *their* team's membership). It is
**shipped** (phase A6): a non-admin who is `admin` on a team gets a member-facing **Teams** screen to
add/remove that team's members — see [`acl.md`](acl.md) §10.

## 4. The boundary (deny-by-default)

The product promise is **isolation**: an end user granted `alice@` must **never** see `support@`'s
mail — not in lists, not in search, not in counts, not by guessing an id. That guarantee is enforced
in one place (the data choke point in [`architecture.md`](architecture.md)); this audience doc just
states the contract the personas rely on:

> Every principal sees **exactly** the mail for the addresses granted to them, and nothing else.
> The owner's "all" is just the grant of every address on the domain.

## 5. Out of scope (explicitly)

- **Open registration is opt-in, not default.** A deployment ships **invite-only**; consumer
  self-serve personal mailboxes exist **only when the owner enables open registration**. The owner
  always controls whether strangers can claim a mailbox on their domain.
- **Cross-domain tenancy in one account** — one deployment serves one domain's mail (multi-domain is a
  later platform concern, not a V1 audience need).
- **Message-level or label-level ACL** — V1 grants are at the **address (mailbox)** level; finer
  grants are a documented future refinement (see [`acl.md`](acl.md)).
