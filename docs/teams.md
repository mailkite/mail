# MailKite Mail — team email over a shared domain

> **One-liner:** MailKite Mail is **email for teams, not end users.** A team owns a
> **whole domain** (e.g. `sendhog.com`); the admin **invites teammates**, who sign in
> with **Google OAuth**; everyone shares access to the domain's mail and can **send as
> any address** on it — `support@`, `hello@`, or per-person — which the team
> **provisions** on demand. There is **no per-sender ACL** (any member may send as any
> address).

This supersedes the single-mailbox framing in [`features.md`](features.md) (V1 "one
mailbox, one model") and the password-only model in [`auth.md`](auth.md). Those still
describe the building blocks; this doc is the product decision they now serve.

## Decision (2026-06)

**MailKite Mail is multi-user team email keyed to a domain.** Concretely:

| Aspect | Decision |
|---|---|
| **Tenant** | One team = one verified domain. The team shares the domain's whole inbox (the catch-all `*@domain` webhook). No per-user mailbox partitioning. |
| **Members** | The **admin invites** teammates by email; invitees **sign in with Google** and are activated on first login. Non-invited Google accounts are rejected. |
| **Login** | **Google OAuth** (authorization-code flow), ported from the MailKite dashboard — same web client id, server-side code exchange. Password login is retained only for **admin bootstrap**. |
| **Sender addresses** | The team **provisions** send-as addresses (`support@`, `hello@`, or per-person `alice@`). Any address on the verified domain is valid — provisioning just records it as a pickable sender. |
| **Sender permissions** | **No ACL for now.** Any member may send as any provisioned address. Per-user sender restrictions are deferred. |
| **Roles** | `admin` — invite/remove members, provision senders, Settings. `member` — read all mail, send as any address. |

### Why

- **Teams, not consumers.** The value is a shared, branded domain inbox a team works out
  of together (support, sales, ops) — not personal webmail. One domain, one team, shared
  context beats per-user silos.
- **OAuth over passwords.** Teams already have Google identities; invite-by-email +
  Google sign-in is the least-friction, most-secure onboarding, and we already run this
  exact flow on the dashboard — so we port it rather than maintain a second auth model.
- **Send-as without ACL (for now).** A small trusted team rarely needs per-sender
  permissions; shipping the simple version first (anyone sends as anything on the domain)
  unblocks the product. ACLs are an additive follow-up if a customer needs them.

## How it works

**Onboarding.** Admin → Settings → Team → *Invite* `alice@gmail.com` (role member). Alice
visits the app, clicks **Sign in with Google**, and — because her email is invited — is
activated. A Google sign-in whose email isn't invited (and isn't the admin) gets a clear
"not invited" rejection.

**Shared inbox.** All members see the same inbox: the domain's catch-all mail. Reading,
threading, labels, and search are over the one shared store (`packages/core`).

**Sending / provisioning.** Compose has a **From** picker listing provisioned senders plus
addresses the inbox has received at. A member can pick any of them, type any other
`@domain` address, or **provision** a new one (e.g. `billing@sendhog.com`). Replies default
From to the address the original was received at. The server passes `from` to MailKite
`/v1/send`, which enforces it's on the verified domain.

## Data model (additive)

- `users` — gains `name`, `provider` (`password` | `google`), `google_sub`, `status`
  (`active` | `invited`), `invited_by`, `avatar_url`. OAuth users carry an empty
  `password_hash` (they never password-login). See [`auth.md`](auth.md).
- `sender_accounts` — `{ id, address (unique), label, created_by, created_at }`. The
  team-wide list of provisioned send-as addresses. No per-user ownership/ACL.

## Deferred (explicitly out of scope now)

- Per-user / per-sender **ACLs** (who may send as which address).
- **Per-user mailboxes** or routing a sub-set of the domain to specific members.
- Non-Google identity providers; SCIM/SSO.
- Emailed invite **links** (today an invite is an allow-listed email; sign-in does the
  rest). An emailed "you've been invited" notice is a nice-to-have, not required.

## Build phases

See [`implementation.md`](implementation.md) Phase T. Order: **T1** schema (this doc +
`users`/`sender_accounts`) → **T2** Google OAuth login (port `google.ts`) → **T3** admin
invites + member management → **T4** sender provisioning UI.
