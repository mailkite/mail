import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import { createApp, type AppDeps } from '../src/app'

async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(extra: Partial<AppDeps> = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  return createApp({
    repo,
    env: { webhookSecret: 'whsec_smoke', apiKey: 'jwt_test', from: 'me@mailn.app', adminEmail: 'admin@x', adminPassword: 'pw' },
    sessionSecret: 'sess_test',
    fetchAttachment: async () => new Uint8Array(),
    ...extra,
  })
}

async function authCookie(app: Awaited<ReturnType<typeof makeApp>>): Promise<string> {
  const res = await app.fetch(new Request('http://x/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@x', password: 'pw' }),
  }))
  return (res.headers.get('set-cookie') ?? '').split(';')[0]
}

const raw = JSON.stringify({
  id: 'msg_http', type: 'email.received', from: { address: 'a@b.com' }, to: [{ address: 'me@mailn.app' }],
  subject: 'Smoke', text: 'hi', html: null, threadId: null,
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0' }, attachments: [],
})

describe('POST /webhook', () => {
  it('verifies signature, stores once, rejects bad sigs; list requires auth', async () => {
    const app = await makeApp()
    const t = Date.now()
    const good = `t=${t},v1=${await sign('whsec_smoke', t, raw)}`

    expect((await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw }))).status).toBe(201)
    expect((await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw }))).status).toBe(200)
    expect((await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': `t=${t},v1=deadbeef` }, body: raw }))).status).toBe(401)

    // unauthenticated read is rejected
    expect((await app.fetch(new Request('http://x/api/messages'))).status).toBe(401)
    // authenticated read works
    const cookie = await authCookie(app)
    const list = await app.fetch(new Request('http://x/api/messages', { headers: { cookie } }))
    expect((await list.json() as { messages: unknown[] }).messages.length).toBe(1)
  })
})

describe('POST /api/send', () => {
  it('requires auth, validates, and proxies a reply', async () => {
    let sent: unknown = null
    const app = await makeApp({ sendEmail: async (input) => { sent = input; return { id: 'out_1', status: 'queued' } } })
    expect((await app.fetch(new Request('http://x/api/send', { method: 'POST', body: '{}' }))).status).toBe(401)

    const cookie = await authCookie(app)
    const ok = await app.fetch(new Request('http://x/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ to: 'a@b.com', subject: 'Re: Smoke', text: 'thanks', inReplyTo: 'msg_http' }),
    }))
    expect(ok.status).toBe(201)
    expect((sent as { from: string }).from).toBe('me@mailn.app')
    expect((sent as { inReplyTo: string }).inReplyTo).toBe('msg_http')
  })

  it('honors a per-message From (send-as identity) over the default', async () => {
    let sent: { from?: string } = {}
    const app = await makeApp({ sendEmail: async (input) => { sent = input; return { id: 'out_2', status: 'queued' } } })
    const cookie = await authCookie(app)
    const res = await app.fetch(new Request('http://x/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ from: 'support@mailn.app', to: 'a@b.com', subject: 'Hi', text: 'yo' }),
    }))
    expect(res.status).toBe(201)
    expect(sent.from).toBe('support@mailn.app')
  })
})

describe('sender provisioning', () => {
  it('provisions addresses (no ACL), rejects bad input, and merges into identities', async () => {
    const app = await makeApp()
    const cookie = await authCookie(app)

    expect((await app.fetch(new Request('http://x/api/senders', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ address: 'nope' }),
    }))).status).toBe(400)

    const made = await app.fetch(new Request('http://x/api/senders', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ address: 'Support@mailn.app', label: 'Support' }),
    }))
    expect(made.status).toBe(201)

    const ids = (await (await app.fetch(new Request('http://x/api/identities', { headers: { cookie } }))).json()) as { identities: string[] }
    expect(ids.identities).toContain('support@mailn.app')
  })
})

describe('GET /api/identities', () => {
  it('lists addresses received at (after an inbound webhook) + the default', async () => {
    const app = await makeApp()
    const t = Date.now()
    await app.fetch(new Request('http://x/webhook', {
      method: 'POST', headers: { 'x-mailkite-signature': `t=${t},v1=${await sign('whsec_smoke', t, raw)}` }, body: raw,
    }))
    const cookie = await authCookie(app)
    const res = await app.fetch(new Request('http://x/api/identities', { headers: { cookie } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { identities: string[]; default: string }
    expect(body.default).toBe('me@mailn.app')
    expect(body.identities).toContain('me@mailn.app')
  })
})
