import { MailRepo } from '@mailkite/core/server'
import { D1Driver, R2BlobStore, type D1DatabaseLike, type R2BucketLike } from '@mailkite/core/server/workers'
import { createApp } from './app'

// Cloudflare bindings + secrets. DB/BLOBS are typed structurally by the core
// providers, so this entry needs no @cloudflare/workers-types dependency.
export interface Env {
  DB: D1DatabaseLike
  BLOBS: R2BucketLike
  ASSETS: { fetch(request: Request): Promise<Response> }
  SESSION_SECRET?: string
  MAILKITE_API_KEY?: string
  MAILKITE_WEBHOOK_SECRET?: string
  MAILKITE_API_BASE?: string
  MAILKITE_FROM?: string
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  APP_NAME?: string
  LOGO_URL?: string
  ADDRESS_MODE?: string
  OPEN_REGISTRATION?: string
}

// Cached per isolate. Prefer setting SESSION_SECRET as a wrangler secret in
// production; the DB fallback keeps sessions stable across isolates otherwise.
let cachedSecret: string | undefined
async function resolveSessionSecret(repo: MailRepo, env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret
  let secret = env.SESSION_SECRET ?? (await repo.getSetting('SESSION_SECRET')) ?? ''
  if (!secret) {
    secret = `${crypto.randomUUID()}${crypto.randomUUID()}`
    await repo.setSetting('SESSION_SECRET', secret)
  }
  cachedSecret = secret
  return secret
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)

    // Static assets + SPA fallback are served by the assets binding; the Worker
    // only owns the backend seam. (Asset hits bypass the Worker entirely; this
    // branch covers SPA client routes that fall through to it.)
    const isBackend = pathname.startsWith('/api') || pathname === '/webhook'
    if (!isBackend) return env.ASSETS.fetch(request)

    // D1 migrations are applied ahead of time (wrangler d1 migrations apply), so
    // we never migrate() in the request path — just bind the providers.
    const repo = new MailRepo(new D1Driver(env.DB), new R2BlobStore(env.BLOBS))
    const app = createApp({
      repo,
      sessionSecret: await resolveSessionSecret(repo, env),
      env: {
        webhookSecret: env.MAILKITE_WEBHOOK_SECRET,
        apiKey: env.MAILKITE_API_KEY,
        apiBase: env.MAILKITE_API_BASE,
        from: env.MAILKITE_FROM,
        adminEmail: env.ADMIN_EMAIL,
        adminPassword: env.ADMIN_PASSWORD,
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET,
        appName: env.APP_NAME,
        logoUrl: env.LOGO_URL,
        addressMode: env.ADDRESS_MODE,
        openRegistration: env.OPEN_REGISTRATION,
      },
    })
    return app.fetch(request)
  },
}
