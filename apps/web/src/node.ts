import { serve } from '@hono/node-server'
import { MailRepo } from '@mailkite/core/server'
import { SqliteDriver, FsBlobStore } from '@mailkite/core/server/node'
import { createApp } from './app'

const webhookSecret = process.env.MAILKITE_WEBHOOK_SECRET
if (!webhookSecret) {
  console.error('MAILKITE_WEBHOOK_SECRET is required (see .env.example)')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 8788)
const dbPath = process.env.DATABASE_PATH ?? './data/mail.sqlite'
const blobRoot = process.env.BLOB_ROOT ?? './data/blobs'

const repo = new MailRepo(new SqliteDriver(dbPath), new FsBlobStore(blobRoot))
await repo.migrate()

serve({ fetch: createApp({ repo, webhookSecret }).fetch, port })
console.log(`MailKite Mail backend listening on http://localhost:${port}`)
