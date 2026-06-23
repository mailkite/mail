import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import { createApp } from '../src/app'

async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  return createApp({
    repo,
    webhookSecret: 'whsec_smoke',
    mailkite: { apiBase: 'https://api.mailkite.dev', apiKey: 'jwt_test', from: 'me@mailn.app' },
    fetchAttachment: async () => new Uint8Array(),
    ...extra,
  })
}

const raw = JSON.stringify({
  id: 'msg_http', type: 'email.received',
  from: { address: 'a@b.com' }, to: [{ address: 'me@mailn.app' }],
  subject: 'Smoke', text: 'hi', html: null, threadId: null,
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0' }, attachments: [],
})

describe('POST /webhook', () => {
  it('verifies the signature, stores once, rejects bad sigs, and lists', async () => {
    const app = await makeApp()
    const t = Date.now()
    const good = `t=${t},v1=${await sign('whsec_smoke', t, raw)}`

    const r1 = await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw }))
    expect(r1.status).toBe(201)
    const r2 = await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw }))
    expect(r2.status).toBe(200)
    const bad = await app.fetch(new Request('http://x/webhook', { method: 'POST', headers: { 'x-mailkite-signature': `t=${t},v1=deadbeef` }, body: raw }))
    expect(bad.status).toBe(401)
    const list = await app.fetch(new Request('http://x/api/messages'))
    expect((await list.json() as { messages: unknown[] }).messages.length).toBe(1)
  })
})

describe('POST /api/send', () => {
  it('rejects missing fields and proxies a valid reply to the sender', async () => {
    let sent: unknown = null
    const app = await makeApp({
      sendEmail: async (input) => { sent = input; return { id: 'out_1', status: 'queued' } },
    })

    const bad = await app.fetch(new Request('http://x/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    expect(bad.status).toBe(400)

    const ok = await app.fetch(new Request('http://x/api/send', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.com', subject: 'Re: Smoke', text: 'thanks', inReplyTo: 'msg_http' }),
    }))
    expect(ok.status).toBe(201)
    expect((sent as { from: string }).from).toBe('me@mailn.app')
    expect((sent as { inReplyTo: string }).inReplyTo).toBe('msg_http')
  })
})
