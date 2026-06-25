import { describe, it, expect } from 'vitest'
import { verifyWebhookSignature, type WebhookPayload } from '../src/index'
import { MailRepo, type BlobStore } from '../src/server/index'
import { SqliteDriver } from '../src/server/node'

async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

class MemoryBlobStore implements BlobStore {
  store = new Map<string, Uint8Array>()
  async put(k: string, d: Uint8Array) { this.store.set(k, d) }
  async get(k: string) { return this.store.get(k) ?? null }
}

const payload: WebhookPayload = {
  id: 'msg_1',
  type: 'email.received',
  from: { address: 'sender@example.com' },
  to: [{ address: 'me@mailn.app' }],
  subject: 'Hello',
  text: 'hi there',
  html: '<p>hi there</p>',
  threadId: null,
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0.1' },
  attachments: [
    { id: 'msg_1:0', filename: 'a.txt', contentType: 'text/plain', size: 3, url: 'https://example.test/att' },
  ],
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature and rejects tampering / stale timestamps', async () => {
    const secret = 'whsec_test'
    const t = 1_700_000_000_000
    const raw = JSON.stringify(payload)
    const header = `t=${t},v1=${await sign(secret, t, raw)}`
    expect((await verifyWebhookSignature({ header, rawBody: raw, secret, now: t })).ok).toBe(true)
    expect((await verifyWebhookSignature({ header, rawBody: raw + 'x', secret, now: t })).ok).toBe(false)
    expect((await verifyWebhookSignature({ header, rawBody: raw, secret, now: t + 10 * 60 * 1000 })).ok).toBe(false)
  })
})

describe('MailRepo.ingestWebhookMessage', () => {
  it('stores the message, rehosts attachments, and is idempotent', async () => {
    const blobs = new MemoryBlobStore()
    const repo = new MailRepo(new SqliteDriver(':memory:'), blobs)
    await repo.migrate()
    const opts = { now: 1_700_000_000_000, fetchAttachment: async () => new Uint8Array([1, 2, 3]) }

    expect((await repo.ingestWebhookMessage(payload, opts)).stored).toBe(true)
    expect((await repo.ingestWebhookMessage(payload, opts)).stored).toBe(false) // dedupe

    const list = await repo.listMessages({ userId: 'sys', isAdmin: true })
    expect(list.length).toBe(1)
    expect(list[0].thread_id).toBe('msg_1')
    expect(list[0].from_addr).toBe('sender@example.com')
    expect(blobs.store.get('att/msg_1/0')).toEqual(new Uint8Array([1, 2, 3]))
  })
})
