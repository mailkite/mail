import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '../src/server/index'
import { SqliteDriver } from '../src/server/node'
import type { WebhookPayload } from '../src/index'

// The actual at-rest crypto (RSA-OAEP + AES-GCM envelope) lives in the shared MailKite SDK
// (@mailkite/client) and is tested there, cross-SDK. Here we only verify the ingest *wiring*: when an
// `encryptBody` transform is supplied it's applied to the bodies (text + html) and NOT to the
// subject/from/to, so the inbox list still works. A trivial stand-in transform keeps this test
// dependency-free and independent of the crypto implementation.

class MemoryBlobStore implements BlobStore {
  store = new Map<string, Uint8Array>()
  async put(k: string, d: Uint8Array) {
    this.store.set(k, d)
  }
  async get(k: string) {
    return this.store.get(k) ?? null
  }
}

const wrap = (t: string | null | undefined): Promise<string | null> =>
  Promise.resolve(t == null || t === '' ? (t ?? null) : `ENC(${t})`)

describe('ingest encryption wiring', () => {
  it('encrypts bodies via encryptBody but keeps subject/from/to plaintext', async () => {
    const repo = new MailRepo(new SqliteDriver(':memory:'), new MemoryBlobStore())
    await repo.migrate()

    const payload: WebhookPayload = {
      id: 'msg_enc_1',
      type: 'email.received',
      from: { address: 'sender@example.com' },
      to: [{ address: 'me@mailn.app' }],
      subject: 'Quarterly numbers',
      text: 'revenue was $1M',
      html: '<p>revenue was $1M</p>',
      threadId: null,
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0.1' },
      attachments: [],
    }

    await repo.ingestWebhookMessage(payload, {
      now: 1_700_000_000_000,
      fetchAttachment: async () => new Uint8Array(),
      encryptBody: wrap,
    })

    const m = await repo.getMessage({ userId: 'sys', isAdmin: true }, 'msg_enc_1')
    expect(m).toBeTruthy()
    // Envelope facts stay readable for listing.
    expect(m!.subject).toBe('Quarterly numbers')
    expect(m!.from_addr).toBe('sender@example.com')
    // Bodies are transformed by encryptBody.
    expect(m!.text_body).toBe('ENC(revenue was $1M)')
    expect(m!.html_body).toBe('ENC(<p>revenue was $1M</p>)')
  })

  it('stores bodies untouched when no encryptBody is supplied', async () => {
    const repo = new MailRepo(new SqliteDriver(':memory:'), new MemoryBlobStore())
    await repo.migrate()
    const payload: WebhookPayload = {
      id: 'msg_plain_1',
      type: 'email.received',
      from: { address: 'a@example.com' },
      to: [{ address: 'me@mailn.app' }],
      subject: 'hi',
      text: 'plain body',
      html: null,
      threadId: null,
      auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: '0' },
      attachments: [],
    }
    await repo.ingestWebhookMessage(payload, { now: 1, fetchAttachment: async () => new Uint8Array() })
    const m = await repo.getMessage({ userId: 'sys', isAdmin: true }, 'msg_plain_1')
    expect(m!.text_body).toBe('plain body')
  })
})
