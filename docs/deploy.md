# Deploying MailKite Mail

Two interchangeable targets behind the same `SqlDriver` / `BlobStore` ports —
same app, same behavior:

| Target | Persistence | Entry | Where |
|---|---|---|---|
| **Node / self-host** | SQLite + filesystem | `apps/web/src/node.ts` | any Node host |
| **Cloudflare Workers** | D1 + R2 | `apps/web/src/worker.ts` | `*.workers.dev` / custom domain |

The Worker owns `/api/*` and `/webhook`; the built SPA in `dist/` is served by
the Workers **assets** binding (SPA fallback on miss).

## Node (self-host)

```sh
cd apps/web
MAILKITE_API_KEY=mk_live_… MAILKITE_WEBHOOK_SECRET=whsec_… npm start
# SQLite at ./data/mail.sqlite, attachments under ./data/blobs
```

`SESSION_SECRET` is generated and saved on first run if unset. Any unset key
disables its feature until set here or in the in-app **Settings** page.

## Cloudflare Workers (D1 + R2)

One-time setup:

```sh
cd apps/web
wrangler d1 create mailkite-mail                 # paste database_id into wrangler.jsonc
wrangler r2 bucket create mailkite-mail-attachments
npm run db:migrate                               # apply migrations/ to D1 (remote)
wrangler secret put SESSION_SECRET               # 32+ random chars
wrangler secret put MAILKITE_API_KEY             # sending/replies
wrangler secret put MAILKITE_WEBHOOK_SECRET      # inbound ingest
```

Deploy:

```sh
npm run deploy        # vite build → wrangler deploy (SPA assets + Worker)
```

Then point a MailKite route's webhook at `https://<your-worker>/webhook`.

### Schema changes

Edit `packages/core/src/server/schema.ts` **and** add a migration in
`apps/web/migrations/` (next numbered `.sql`). The Node target applies
`SCHEMA_SQL` at runtime; D1 applies the migrations. `migration-drift.test.ts`
fails if the two diverge — keep them in sync.

### Notes

- D1 migrations are applied ahead of deploy; the Worker never migrates in the
  request path.
- Config resolution is **env/secret → saved DB setting → unset** on both
  targets; platform secrets always win (see [`admin-dashboard.md`](admin-dashboard.md)).
