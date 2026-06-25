# MailKite Mail — target audience

> **One-liner:** MailKite Mail is **not consumer webmail.** It is a tool for the **person who
> controls a domain** — a developer, indie maker, agency, or website owner — to read and route the
> mail their domain receives, and to **delegate scoped access** to teams and individual users.
> Access is **tiered**: the owner sees **all** mail; a team sees a **subset** of mailbox addresses;
> an end user sees a **subset, or a single** address.

This supersedes the "team email over a shared domain, no per-user ACL" framing in
[`teams.md`](teams.md). The product is now **domain-owner-first with delegated, scoped access** —
the ACL model is in [`acl.md`](acl.md), the runtime in [`architecture.md`](architecture.md), and
the build order in [`implementation.md`](implementation.md).

## 1. Who it's for

| Persona | Who they are | What they get |
|---|---|---|
| **Domain owner / maker** | The developer, indie hacker, agency, or website owner who controls the domain (DNS + the MailKite webhook). The buyer and the super-admin. | **All mail** on the domain. Provisions addresses, creates teams, invites users, grants access, configures the app. |
| **Team** | A named group the owner creates — e.g. *Support*, *Sales*, *Billing* — granted a **set of addresses**. | The mail for **the addresses granted to the team** (e.g. `support@`, `help@`). Members send as any of those. |
| **End user** | An individual the owner (or a team admin) invites — a contractor, a client, a teammate who only handles one inbox. | The mail for **the address(es) granted to them** — often **just one** (e.g. `alice@`). Nothing else on the domain. |

The unifying idea: **the owner holds the domain; everyone else holds a delegated slice of it.**

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

| Capability | Owner | Team (member) | End user |
|---|---|---|---|
| Read mail for **all** addresses | ✅ | — | — |
| Read mail for **granted** addresses | ✅ | ✅ | ✅ |
| Send as a **granted** address | ✅ | ✅ | ✅ |
| Provision a new address | ✅ | — | — |
| Create teams / grant access | ✅ | (team-admin: within team) | — |
| Invite users | ✅ | (team-admin) | — |
| Configure the app (keys, branding) | ✅ | — | — |

A **team-admin** is an optional middle tier (a member who can manage *their* team's membership) —
see [`acl.md`](acl.md) for whether it ships in V1 or later.

## 4. The boundary (deny-by-default)

The product promise is **isolation**: an end user granted `alice@` must **never** see `support@`'s
mail — not in lists, not in search, not in counts, not by guessing an id. That guarantee is enforced
in one place (the data choke point in [`architecture.md`](architecture.md)); this audience doc just
states the contract the personas rely on:

> Every principal sees **exactly** the mail for the addresses granted to them, and nothing else.
> The owner's "all" is just the grant of every address on the domain.

## 5. Out of scope (explicitly)

- **Consumer signups / personal webmail** — there is no public "sign up and get a mailbox." Access is
  always granted by the domain owner.
- **Cross-domain tenancy in one account** — one deployment serves one domain's mail (multi-domain is a
  later platform concern, not a V1 audience need).
- **Message-level or label-level ACL** — V1 grants are at the **address (mailbox)** level; finer
  grants are a documented future refinement (see [`acl.md`](acl.md)).
