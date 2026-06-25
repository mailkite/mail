import { serve } from '@hono/node-server'
import { MailRepo } from '@mailkite/core/server'
import { SqliteDriver, FsBlobStore } from '@mailkite/core/server/node'
import { createApp } from './app'

const port = Number(process.env.PORT ?? 8788)
const dbPath = process.env.DATABASE_PATH ?? './data/mail.sqlite'
const blobRoot = process.env.BLOB_ROOT ?? './data/blobs'

const repo = new MailRepo(new SqliteDriver(dbPath), new FsBlobStore(blobRoot))
await repo.migrate()

// Session secret: env → saved → generated (and saved so sessions survive restart).
let sessionSecret = process.env.SESSION_SECRET ?? (await repo.getSetting('SESSION_SECRET')) ?? ''
if (!sessionSecret) {
  sessionSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`
  await repo.setSetting('SESSION_SECRET', sessionSecret)
  console.warn('Generated SESSION_SECRET and saved it (set SESSION_SECRET env to override).')
}

const env = {
  webhookSecret: process.env.MAILKITE_WEBHOOK_SECRET,
  apiKey: process.env.MAILKITE_API_KEY,
  apiBase: process.env.MAILKITE_API_BASE,
  from: process.env.MAILKITE_FROM,
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  appName: process.env.APP_NAME,
  logoUrl: process.env.LOGO_URL,
  addressMode: process.env.ADDRESS_MODE,
}
if (!env.webhookSecret) console.warn('MAILKITE_WEBHOOK_SECRET unset — inbound disabled until set in Settings')
if (!env.apiKey) console.warn('MAILKITE_API_KEY unset — sending disabled until set in Settings')

serve({ fetch: createApp({ repo, env, sessionSecret }).fetch, port })
console.log(`MailKite Mail backend listening on http://localhost:${port}`)
