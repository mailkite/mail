# Contributing to MailKite Mail

Thanks for wanting to help. This project is a webhook-driven webmail client for
[MailKite](https://mailkite.dev), released under **AGPL-3.0**.

## Contributor License Agreement (required)

Before your first pull request can be merged, you must agree to the
[Contributor License Agreement](CLA.md). It's a one-time action that covers all
your future contributions.

When you open a pull request, the **CLA Assistant** bot comments with a link and a
sentence to reply with. Reply once and you're set — the bot updates the PR
automatically.

**Why we ask:** MailKite Mail stays AGPL-3.0 forever, and you keep the copyright to
your work. The CLA is a *license*, not an assignment — it lets MailKite LLC also
offer the project under a separate commercial/white-label license, which is what
funds the open-source work. See [CLA.md](CLA.md) for the full rationale. Nothing in
it stops you from using your own contribution however you like.

**Contributing for your employer?** Email **legal@mailkite.dev** to set up a
Corporate CLA before your PR is merged, so the entity — not just you as an
individual — grants the license.

## Development

This is a pnpm + Turborepo monorepo. It runs the same codebase two ways:
Cloudflare Workers (assets + D1) or Node.js (`@hono/node-server` + SQLite).

```bash
pnpm install
pnpm dev        # local dev
pnpm build      # production build
pnpm test       # tests, if present
```

See [`docs/`](docs/) for architecture — start with
[`docs/00-overview.md`](docs/00-overview.md), and
[`docs/install.md`](docs/install.md) for self-hosting.

## Pull requests

- Branch from `main`; keep PRs focused on one change.
- Match the existing code style (TypeScript, the shape of the surrounding files).
- Describe what changed and why. Link any related issue.
- Make sure the build passes before requesting review.

## Reporting bugs & requesting features

Open a [GitHub issue](https://github.com/mailkite/mail/issues). For anything
security-sensitive, **do not open a public issue** — email
**security@mailkite.dev** instead.

## Licensing of your contribution

By contributing, you agree your contribution is licensed under AGPL-3.0 as part of
the project, and you grant MailKite LLC the additional rights described in
[CLA.md](CLA.md). You retain copyright to your work.
