import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import type { WebhookPayload } from '../src/index'
import { MailRepo, type BlobStore } from '../src/server/index'
import { D1Driver, type D1DatabaseLike, type D1PreparedStatementLike } from '../src/server/workers'

// A structural D1 binding backed by better-sqlite3, so the D1 provider can be
// exercised in plain Node. D1 is SQLite under the hood, so this proves MailRepo
// behaves identically on the Workers persistence provider as on the Node one.
class FakeD1Statement implements D1PreparedStatementLike {
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}
  bind(...values: unknown[]): D1PreparedStatementLike {
    return new FakeD1Statement(this.db, this.sql, values)
  }
  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...(this.params as never[]))
  }
  async first<T = unknown>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) ?? null) as T | null
  }
  async all<T = unknown>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] }
  }
}
class FakeD1 implements D1DatabaseLike {
  constructor(private readonly db = new Database(':memory:')) {}
  prepare(query: string): D1PreparedStatementLike {
    return new FakeD1Statement(this.db, query)
  }
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

describe('D1Driver — MailRepo parity with the Node provider', () => {
  it('migrates, ingests idempotently, rehosts attachments, and reads back', async () => {
    const blobs = new MemoryBlobStore()
    const repo = new MailRepo(new D1Driver(new FakeD1()), blobs)
    await repo.migrate()
    const opts = { now: 1_700_000_000_000, fetchAttachment: async () => new Uint8Array([1, 2, 3]) }

    expect((await repo.ingestWebhookMessage(payload, opts)).stored).toBe(true)
    expect((await repo.ingestWebhookMessage(payload, opts)).stored).toBe(false) // dedupe

    const list = await repo.listMessages()
    expect(list.length).toBe(1)
    expect(list[0].thread_id).toBe('msg_1')
    expect(list[0].from_addr).toBe('sender@example.com')
    expect(blobs.store.get('att/msg_1/0')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('supports settings + users round-trips (ON CONFLICT, COUNT)', async () => {
    const repo = new MailRepo(new D1Driver(new FakeD1()), new MemoryBlobStore())
    await repo.migrate()

    expect(await repo.countUsers()).toBe(0)
    await repo.setSetting('MAILKITE_FROM', 'a@b.com')
    await repo.setSetting('MAILKITE_FROM', 'c@d.com') // upsert
    expect(await repo.getSetting('MAILKITE_FROM')).toBe('c@d.com')

    await repo.createUser({
      id: 'usr_1', email: 'admin@x', password_hash: 'h', role: 'admin', created_at: 1,
    })
    expect(await repo.countUsers()).toBe(1)
    expect((await repo.getUserByEmail('admin@x'))?.role).toBe('admin')
  })
})
