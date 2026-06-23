# MailKite Mail

> An open-source, webhook-driven webmail client. It ingests mail from a
> [MailKite](https://mailkite.dev) webhook into its own store and sends through MailKite's
> API — so anyone can self-host a real inbox with nothing but an API key and a webhook secret.

**No mail server. No IMAP/POP. No SMTP relay to babysit.** Mail arrives as `email.received`
webhook payloads; you browse, search, thread, and reply from a fast, modern UI.

Hosted at **[mailn.app](https://mailn.app)** · part of the MailKite family.

## Status

🚧 Early — the planning docs are written; the app is being scaffolded.

## How it works

```
MailKite  ──webhook──▶  POST /webhook  ──▶  own store (SQLite / D1)  ──▶  React/Vite UI
 (inbound mail)          (verify HMAC)                                        │
                                                                  reply ──▶ MailKite /v1/send
```

- **Frontend** — React + Vite + TanStack Router + shadcn/ui + Tailwind CSS 4
- **Backend** — Hono, serving the SPA and the local API
- **Runs two ways from one codebase** — Cloudflare Workers (assets + D1) or Node.js (`@hono/node-server` + SQLite)
- **Storage** — its own webhook-fed store; it never touches MailKite's database

## Documentation

See [`docs/`](docs/) — start with the [overview](docs/00-overview.md).

| Doc | What's inside |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | Positioning, goals & non-goals |
| [docs/features.md](docs/features.md) | Feature inventory, tiered V1 / V2 / Later |
| [docs/stack.md](docs/stack.md) | Hono + Vite/React, dual Workers/Node runtime |
| [docs/architecture.md](docs/architecture.md) | Webhook ingest → store → render → reply |
| [docs/data-model.md](docs/data-model.md) | Own-store schema + storage adapter |
| [docs/install.md](docs/install.md) | Self-host on Node.js, Docker, or Workers |

## License

[AGPL-3.0](LICENSE) © Fiji Web Design
