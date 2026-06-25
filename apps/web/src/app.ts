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
  hashToken,
  exchangeGoogleCode,
  decodeGoogleIdToken,
} from '@mailkite/core/server'
import type { SendInput, SendResult, SessionPayload, UserRow } from '@mailkite/core/server'

export interface AppEnvConfig {
  webhookSecret?: string
  apiKey?: string
  apiBase?: string
  from?: string
  adminEmail?: string
  adminPassword?: string
  googleClientId?: string
  googleClientSecret?: string
  appName?: string
  logoUrl?: string
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
  { key: 'GOOGLE_CLIENT_ID', secret: false, gates: 'google sign-in', env: (e: AppEnvConfig) => e.googleClientId },
  { key: 'GOOGLE_CLIENT_SECRET', secret: true, gates: 'google sign-in', env: (e: AppEnvConfig) => e.googleClientSecret },
  { key: 'APP_NAME', secret: false, gates: 'branding', env: (e: AppEnvConfig) => e.appName },
  { key: 'LOGO_URL', secret: false, gates: 'branding', env: (e: AppEnvConfig) => e.logoUrl },
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
    const googleClientId = await resolve('GOOGLE_CLIENT_ID', deps.env.googleClientId)
    const googleClientSecret = await resolve('GOOGLE_CLIENT_SECRET', deps.env.googleClientSecret)
    const oauth = Boolean(googleClientId && googleClientSecret)
    const appName = (await resolve('APP_NAME', deps.env.appName)) || 'MailKite Mail'
    const logoUrl = await resolve('LOGO_URL', deps.env.logoUrl)
    // googleClientId is public (the SPA builds the consent URL with it); the
    // secret never leaves the server.
    return c.json({
      sending,
      push: false,
      needsSetup,
      oauth,
      googleClientId: oauth ? googleClientId : '',
      appName,
      logoUrl,
    })
  })

  // ---- Auth -----------------------------------------------------------------
  const CODE_TTL = 15 * 60 * 1000
  const norm = (e: string) => e.trim().toLowerCase()

  /** Generate a 6-digit code, store it hashed, and email it to the address. */
  async function sendVerificationCode(email: string): Promise<{ ok: boolean; error?: string }> {
    const apiKey = await resolve('MAILKITE_API_KEY', deps.env.apiKey)
    const from = await resolve('MAILKITE_FROM', deps.env.from)
    if (!apiKey || !from) {
      return { ok: false, error: 'email sending not configured (set MAILKITE_API_KEY + MAILKITE_FROM)' }
    }
    const code = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000)
    const now = Date.now()
    await deps.repo.putEmailCode(email, await hashToken(code), now + CODE_TTL, now)
    const apiBase = (await resolve('MAILKITE_API_BASE', deps.env.apiBase)) || 'https://api.mailkite.dev'
    try {
      await sendEmail(
        {
          from,
          to: email,
          subject: 'Your MailKite Mail verification code',
          text: `Your verification code is ${code}\n\nIt expires in 15 minutes.`,
        },
        apiBase,
        apiKey,
      )
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'failed to send code' }
    }
  }

  // Sign up with email + password → emails a one-time code. The first user to
  // verify becomes the admin (see docs/teams.md).
  app.post('/api/admin/signup', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; password?: string } | null
    if (!body?.email || !body.password) return c.json({ error: 'email and password required' }, 400)
    if (body.password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400)
    const email = norm(body.email)
    const existing = await deps.repo.getUserByEmail(email)
    if (existing && existing.status === 'active') return c.json({ error: 'account exists — sign in' }, 409)

    const count = await deps.repo.countUsers()
    if (!existing && count > 0) {
      return c.json({ error: 'not invited — ask your team admin to add you' }, 403)
    }

    const passwordHash = await hashPassword(body.password)
    if (!existing) {
      const role = count === 0 ? 'admin' : 'user' // first user is the admin
      await deps.repo.createUser({
        id: `usr_${crypto.randomUUID()}`,
        email,
        password_hash: passwordHash,
        role,
        created_at: Date.now(),
        provider: 'password',
        status: 'pending',
      })
    } else {
      await deps.repo.setUserPassword(email, passwordHash) // re-signup of a pending account
    }
    const sent = await sendVerificationCode(email)
    if (!sent.ok) return c.json({ error: sent.error }, 503)
    return c.json({ status: 'pending', email }, 201)
  })

  app.post('/api/admin/verify', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; code?: string } | null
    if (!body?.email || !body.code) return c.json({ error: 'email and code required' }, 400)
    const email = norm(body.email)
    const ok = await deps.repo.consumeEmailCode(email, await hashToken(body.code.trim()), Date.now())
    if (!ok) return c.json({ error: 'invalid or expired code' }, 400)
    await deps.repo.setUserStatus(email, 'active')
    const u = await deps.repo.getUserByEmail(email)
    if (!u) return c.json({ error: 'account not found' }, 404)
    await startSession(c, { uid: u.id, role: u.role, email: u.email })
    return c.json({ email: u.email, role: u.role })
  })

  app.post('/api/admin/resend', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string } | null
    if (!body?.email) return c.json({ error: 'email required' }, 400)
    const u = await deps.repo.getUserByEmail(norm(body.email))
    if (!u || u.status !== 'pending') return c.json({ ok: true }) // don't reveal account state
    const sent = await sendVerificationCode(u.email)
    return sent.ok ? c.json({ ok: true }) : c.json({ error: sent.error }, 503)
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

    const u = await deps.repo.getUserByEmail(norm(body.email))
    if (!u || !(await verifyPassword(body.password, u.password_hash))) {
      return c.json({ error: 'invalid credentials' }, 401)
    }
    if (u.status === 'pending') {
      return c.json({ error: 'verify your email to finish signing up', code: 'unverified', email: u.email }, 403)
    }
    await startSession(c, { uid: u.id, role: u.role, email: u.email })
    return c.json({ email: u.email, role: u.role })
  })

  // Google OAuth: the SPA gets a one-time code at <origin>/auth/google/callback
  // and POSTs it here. We exchange it (confidential client), verify the ID
  // token's aud, then upsert the user + session. First user becomes admin.
  app.post('/api/auth/google', async (c) => {
    const clientId = await resolve('GOOGLE_CLIENT_ID', deps.env.googleClientId)
    const clientSecret = await resolve('GOOGLE_CLIENT_SECRET', deps.env.googleClientSecret)
    if (!clientId || !clientSecret) return c.json({ error: 'Google sign-in is not configured' }, 503)
    const body = (await c.req.json().catch(() => null)) as { code?: string; redirectUri?: string } | null
    if (!body?.code || !body.redirectUri) return c.json({ error: 'code and redirectUri required' }, 400)

    const idToken = await exchangeGoogleCode({ code: body.code, redirectUri: body.redirectUri, clientId, clientSecret })
    const identity = idToken ? decodeGoogleIdToken(idToken) : null
    if (!identity || identity.aud !== clientId || !identity.email) {
      return c.json({ error: 'Google sign-in failed' }, 401)
    }
    const gEmail = identity.email.toLowerCase()
    if (!(await deps.repo.getUserByEmail(gEmail)) && (await deps.repo.countUsers()) > 0) {
      return c.json({ error: 'not invited — ask your team admin to add you' }, 403)
    }
    const u = await deps.repo.upsertGoogleUser({
      email: gEmail,
      sub: identity.sub,
      name: identity.name,
      picture: identity.picture,
    })
    await startSession(c, { uid: u.id, role: u.role, email: u.email })
    return c.json({ email: u.email, role: u.role })
  })

  app.post('/api/admin/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/me', requireAuth, async (c) => {
    const u = c.get('user') as SessionPayload
    const row = await deps.repo.getUserById(u.uid)
    return c.json({
      email: u.email,
      role: u.role,
      name: row?.name ?? null,
      avatarUrl: row?.avatar_url ?? null,
    })
  })

  // Self-service: delete your own account and end the session. The last
  // remaining admin is blocked so the workspace can't be left without one.
  app.post('/api/admin/account/delete', requireAuth, async (c) => {
    const u = c.get('user') as SessionPayload
    if (u.role === 'admin') {
      const admins = (await deps.repo.listUsers()).filter((x) => x.role === 'admin')
      if (admins.length <= 1) {
        return c.json(
          { error: 'You are the only admin. Promote another member to admin before deleting your account.' },
          400,
        )
      }
    }
    await deps.repo.deleteUser(u.uid)
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  // ---- Team members (admin only) -------------------------------------------
  const publicUser = (u: UserRow) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status ?? 'active',
    provider: u.provider ?? 'password',
    name: u.name ?? null,
  })

  app.get('/api/admin/users', requireAdmin, async (c) => {
    return c.json({ users: (await deps.repo.listUsers()).map(publicUser) })
  })

  // Invite by email: creates an 'invited' member. They join by signing in
  // (email+code or Google) with that address; uninvited sign-ins are rejected.
  app.post('/api/admin/users', requireAdmin, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: string; role?: string } | null
    if (!body?.email) return c.json({ error: 'email required' }, 400)
    const email = norm(body.email)
    if (await deps.repo.getUserByEmail(email)) return c.json({ error: 'user already exists' }, 409)
    const u: UserRow = {
      id: `usr_${crypto.randomUUID()}`,
      email,
      password_hash: '',
      role: body.role === 'admin' ? 'admin' : 'user',
      created_at: Date.now(),
      status: 'invited',
      invited_by: c.get('user').email,
    }
    await deps.repo.createUser(u)
    return c.json(publicUser(u), 201)
  })

  app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id')!
    const target = await deps.repo.getUserById(id)
    if (!target) return c.json({ error: 'not found' }, 404)
    if (target.id === c.get('user').uid) return c.json({ error: 'you cannot remove yourself' }, 400)
    await deps.repo.deleteUser(id)
    return c.json({ ok: true })
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

  // ---- Mail API (auth required, ACL-scoped via the Actor) ------------------
  // The Actor is built server-side from the session — the only input to scoping.
  const actorOf = (c: Context<AppEnv>) => {
    const u = c.get('user')
    return { userId: u.uid, isAdmin: u.role === 'admin' }
  }

  app.get('/api/messages', requireAuth, async (c) => {
    const folder = c.req.query('folder') as 'inbox' | 'starred' | 'archive' | undefined
    const q = c.req.query('q') || undefined
    return c.json({ messages: await deps.repo.listMessages(actorOf(c), { folder, q }) })
  })

  app.get('/api/messages/:id', requireAuth, async (c) => {
    const m = await deps.repo.getMessage(actorOf(c), c.req.param('id')!)
    return m ? c.json({ message: m }) : c.json({ error: 'not found' }, 404)
  })

  app.patch('/api/messages/:id', requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { unread?: boolean; starred?: boolean; archived?: boolean }
      | null
    if (!body) return c.json({ error: 'invalid body' }, 400)
    await deps.repo.updateFlags(actorOf(c), c.req.param('id')!, body)
    const m = await deps.repo.getMessage(actorOf(c), c.req.param('id')!)
    return m ? c.json({ message: m }) : c.json({ error: 'not found' }, 404)
  })

  // Send-as identities: provisioned sender addresses + the addresses the actor is
  // granted + the configured default. The compose UI picks `from` from these.
  app.get('/api/identities', requireAuth, async (c) => {
    const provisioned = (await deps.repo.listSenderAccounts()).map((s) => s.address)
    const granted = await deps.repo.listIdentities(actorOf(c))
    const dflt = (await resolve('MAILKITE_FROM', deps.env.from)) || granted[0] || provisioned[0] || ''
    const identities = [...new Set([dflt, ...granted, ...provisioned].filter(Boolean))]
    return c.json({ identities, default: dflt })
  })

  // Provisioned send-as addresses (team-wide, no ACL — any member manages them).
  app.get('/api/senders', requireAuth, async (c) => {
    return c.json({ senders: await deps.repo.listSenderAccounts() })
  })

  app.post('/api/senders', requireAuth, async (c) => {
    const body = (await c.req.json().catch(() => null)) as { address?: string; label?: string } | null
    const address = body?.address?.trim().toLowerCase()
    if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return c.json({ error: 'a valid address is required' }, 400)
    if (await deps.repo.getSenderByAddress(address)) return c.json({ error: 'already added' }, 409)
    const sender = {
      id: `snd_${crypto.randomUUID()}`,
      address,
      label: body?.label?.trim() || null,
      created_by: c.get('user').email,
      created_at: Date.now(),
    }
    await deps.repo.createSenderAccount(sender)
    return c.json(sender, 201)
  })

  app.delete('/api/senders/:id', requireAuth, async (c) => {
    await deps.repo.deleteSenderAccount(c.req.param('id')!)
    return c.json({ ok: true })
  })

  app.post('/api/send', requireAuth, async (c) => {
    const apiKey = await resolve('MAILKITE_API_KEY', deps.env.apiKey)
    if (!apiKey) return c.json({ error: 'sending not configured (set MAILKITE_API_KEY)' }, 503)
    const body = (await c.req.json().catch(() => null)) as Partial<SendInput> | null
    if (!body?.to || !body.subject) return c.json({ error: '`to` and `subject` are required' }, 400)

    // Per-message From (send-as) wins; fall back to the configured default.
    const from = body.from?.trim() || (await resolve('MAILKITE_FROM', deps.env.from))
    if (!from) {
      return c.json({ error: 'no From address — pick one in the message or set MAILKITE_FROM in Settings' }, 400)
    }
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
