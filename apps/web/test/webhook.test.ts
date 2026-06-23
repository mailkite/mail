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

const raw = JSON.stringify({
  id: 'msg_http', type: 'email.received',
  from: { address: 'a@b.com' }, to: [{ address: 'me@mailn.app' }],
  subject: 'Smoke', text: 'hi', html: null, threadId: null,
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0' }, attachments: [],
})

describe('POST /webhook', () => {
  it('verifies the signature, stores once, rejects bad sigs, and lists', async () => {
    const secret = 'whsec_smoke'
    const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
    await repo.migrate()
    const app = createApp({ repo, webhookSecret: secret, fetchAttachment: async () => new Uint8Array() })

    const t = Date.now() // within the 5-min tolerance the route enforces
    const good = `t=${t},v1=${await sign(secret, t, raw)}`

    const r1 = await app.fetch(new Request('http://x/webhook', {
      method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw,
    }))
    expect(r1.status).toBe(201)

    const r2 = await app.fetch(new Request('http://x/webhook', {
      method: 'POST', headers: { 'x-mailkite-signature': good }, body: raw,
    }))
    expect(r2.status).toBe(200) // idempotent re-delivery

    const bad = await app.fetch(new Request('http://x/webhook', {
      method: 'POST', headers: { 'x-mailkite-signature': `t=${t},v1=deadbeef` }, body: raw,
    }))
    expect(bad.status).toBe(401)

    const list = await app.fetch(new Request('http://x/api/messages'))
    expect((await list.json() as { messages: unknown[] }).messages.length).toBe(1)
  })
})
