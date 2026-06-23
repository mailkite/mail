import { Hono, type Context, type Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { verifyWebhookSignature } from '@mailkite/core'
import type { WebhookPayload } from '@mailkite/core'
import {
  MailRepo,
  sendViaMailkite,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
} from '@mailkite/core/server'
import type { SendInput, SendResult, SessionPayload } from '@mailkite/core/server'

export interface AppEnvConfig {
  webhookSecret?: string
  apiKey?: string
  apiBase?: string
  from?: string
  adminEmail?: string
  adminPassword?: string
}

export interface AppDeps {
  repo: MailRepo
  env: AppEnvConfig
  sessionSecret: string
  fetchAttachment?: (url: string) => Promise<Uint8Array>
  sendEmail?: (input: SendInput) => Promise<SendResult>
}

type AppEnv = { Variables: { user: SessionPayload } }

const COOKIE = 'mk_session'
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000

const CONFIG_ITEMS = [
  { key: 'MAILKITE_API_KEY', secret: true, gates: 'sending', env: (e: AppEnvConfig) => e.apiKey },
  { key: 'MAILKITE_WEBHOOK_SECRET', secret: true, gates: 'ingest', env: (e: AppEnvConfig) => e.webhookSecret },
  { key: 'MAILKITE_API_BASE', secret: false, gates: null, env: (e: AppEnvConfig) => e.apiBase },
  { key: 'MAILKITE_FROM', secret: false, gates: null, env: (e: AppEnvConfig) => e.from },
] as const

const CONFIG_KEYS = new Set<string>(CONFIG_ITEMS.map((i) => i.key))
const mask = (v: string) => (v.length <= 4 ? '••••' : `••••${v.slice(-4)}`)

async function defaultFetchAttachment(url: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`attachment fetch failed: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const fetchAttachment = deps.fetchAttachment ?? defaultFetchAttachment
  const sendEmail = (input: SendInput, apiBase: string, apiKey: string): Promise<SendResult> =>
    deps.sendEmail ? deps.sendEmail(input) : sendViaMailkite(input, { apiBase, apiKey })

  /** env var → saved DB setting → '' */
  const resolve = async (key: string, envVal: string | undefined): Promise<string> =>
    envVal || (await deps.repo.getSetting(key)) || ''

  const userOf = (c: Context) => verifySession(getCookie(c, COOKIE), deps.sessionSecret)

  const startSession = async (c: Context, p: { uid: string; role: 'admin' | 'user'; email: string }) => {
    const token = await signSession({ ...p, exp: Date.now() + SESSION_TTL }, deps.sessionSecret)
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: c.req.url.startsWith('https://'),
      maxAge: SESSION_TTL / 1000,
    })
  }

  const requireAuth = async (c: Context<AppEnv>, next: Next) => {
    const u = await userOf(c)
    if (!u) return c.json({ error: 'unauthorized' }, 401)
    c.set('user', u)
    await next()
  }
  const requireAdmin = async (c: Context<AppEnv>, next: Next) => {
    const u = await userOf(c)
    if (!u) return c.json({ error: 'unauthorized' }, 401)
    if (u.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
    c.set('user', u)
    await next()
  }

  app.get('/api/health', (c) => c.json({ ok: true }))

  // ---- Capabilities (public) ------------------------------------------------
  app.get('/api/config', async (c) => {
    const sending = Boolean(await resolve('MAILKITE_API_KEY', deps.env.apiKey))
    const needsSetup = !deps.env.adminPassword && (await deps.repo.countUsers()) === 0
    return c.json({ sending, push: false, needsSetup })
  })

  // ---- Auth -----------------------------------------------------------------
  app.post('/api/admin/setup', async (c) => {
    if (deps.env.adminPassword || (await deps.repo.countUsers()) > 0) {
      return c.json({ error: 'setup already complete' }, 409)
    }
    const body = (await c.req.json().catch(() => null)) as { email?: string; password?: string } | null
    if (!body?.email || !body.password) return c.json({ error: 'email and password required' }, 400)
    const user = {
      id: `usr_${crypto.randomUUID()}`,
      email: body.email,
      password_hash: await hashPassword(body.password),
      role: 'admin' as const,
      created_at: Date.now(),
    }
    await deps.repo.createUser(user)
    await startSession(c, { uid: user.id, role: 'admin', email: user.email })
    return c.json({ email: user.email, role: 'admin' }, 201)
  })

  app.post('/api/admin/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; password?: string } | null
    if (!body?.email || !body.password) return c.json({ error: 'email and password required' }, 400)

    if (
      deps.env.adminPassword &&
      body.email === (deps.env.adminEmail || 'admin') &&
      body.password === deps.env.adminPassword
    ) {
      await startSession(c, { uid: 'env-admin', role: 'admin', email: body.email })
      return c.json({ email: body.email, role: 'admin' })
    }

    const u = await deps.repo.getUserByEmail(body.email)
    if (!u || !(await verifyPassword(body.password, u.password_hash))) {
      return c.json({ error: 'invalid credentials' }, 401)
    }
    await startSession(c, { uid: u.id, role: u.role, email: u.email })
    return c.json({ email: u.email, role: u.role })
  })

  app.post('/api/admin/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/me', requireAuth, (c) => {
    const u = c.get('user') as SessionPayload
    return c.json({ email: u.email, role: u.role })
  })

  // ---- Admin config (admin only) -------------------------------------------
  app.get('/api/admin/config', requireAdmin, async (c) => {
    const items = []
    for (const it of CONFIG_ITEMS) {
      const envVal = it.env(deps.env)
      const saved = await deps.repo.getSetting(it.key)
      const source = envVal ? 'env' : saved ? 'saved' : 'unset'
      const raw = envVal || saved || ''
      items.push({
        key: it.key,
        secret: it.secret,
        gates: it.gates,
        source,
        value: it.secret ? (raw ? mask(raw) : '') : raw,
      })
    }
    return c.json({ items })
  })

  app.post('/api/admin/config', requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { key?: string; value?: string } | null
    if (!body?.key || body.value === undefined) return c.json({ error: 'key and value required' }, 400)
    if (!CONFIG_KEYS.has(body.key)) return c.json({ error: 'unknown config key' }, 400)
    await deps.repo.setSetting(body.key, body.value)
    return c.json({ ok: true })
  })

  // ---- Inbound webhook (HMAC-verified, not session-gated) -------------------
  app.post('/webhook', async (c) => {
    const secret = await resolve('MAILKITE_WEBHOOK_SECRET', deps.env.webhookSecret)
    if (!secret) return c.json({ error: 'webhook not configured' }, 503)
    const raw = await c.req.text()
    const verdict = await verifyWebhookSignature({
      header: c.req.header('x-mailkite-signature'),
      rawBody: raw,
      secret,
      now: Date.now(),
    })
    if (!verdict.ok) return c.json({ error: verdict.reason }, 401)

    let payload: WebhookPayload
    try {
      payload = JSON.parse(raw) as WebhookPayload
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }
    if (payload?.type !== 'email.received') return c.json({ error: 'unsupported event' }, 422)

    const { stored } = await deps.repo.ingestWebhookMessage(payload, { now: Date.now(), fetchAttachment })
    return c.json({ id: payload.id, stored }, stored ? 201 : 200)
  })

  // ---- Mail API (auth required) --------------------------------------------
  app.get('/api/messages', requireAuth, async (c) => {
    const folder = c.req.query('folder') as 'inbox' | 'starred' | 'archive' | undefined
    const q = c.req.query('q') || undefined
    return c.json({ messages: await deps.repo.listMessages({ folder, q }) })
  })

  app.get('/api/messages/:id', requireAuth, async (c) => {
    const m = await deps.repo.getMessage(c.req.param('id')!)
    return m ? c.json({ message: m }) : c.json({ error: 'not found' }, 404)
  })

  app.patch('/api/messages/:id', requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { unread?: boolean; starred?: boolean; archived?: boolean }
      | null
    if (!body) return c.json({ error: 'invalid body' }, 400)
    await deps.repo.updateFlags(c.req.param('id')!, body)
    const m = await deps.repo.getMessage(c.req.param('id')!)
    return m ? c.json({ message: m }) : c.json({ error: 'not found' }, 404)
  })

  app.post('/api/send', requireAuth, async (c) => {
    const apiKey = await resolve('MAILKITE_API_KEY', deps.env.apiKey)
    if (!apiKey) return c.json({ error: 'sending not configured (set MAILKITE_API_KEY)' }, 503)
    const body = (await c.req.json().catch(() => null)) as Partial<SendInput> | null
    if (!body?.to || !body.subject) return c.json({ error: '`to` and `subject` are required' }, 400)

    const from = await resolve('MAILKITE_FROM', deps.env.from)
    const apiBase = (await resolve('MAILKITE_API_BASE', deps.env.apiBase)) || 'https://api.mailkite.dev'
    try {
      const result = await sendEmail(
        { from, to: body.to, subject: body.subject, text: body.text, html: body.html, inReplyTo: body.inReplyTo, cc: body.cc, bcc: body.bcc, replyTo: body.replyTo },
        apiBase,
        apiKey,
      )
      return c.json(result, 201)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'send failed' }, 502)
    }
  })

  return app
}
