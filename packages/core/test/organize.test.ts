import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '../src/server/index'
import { SqliteDriver } from '../src/server/node'
import type { WebhookPayload } from '../src/index'

const blobs: BlobStore = { async put() {}, async get() { return null } }
const ADMIN = { userId: 'sys', isAdmin: true }

function payload(id: string, subject: string): WebhookPayload {
  return {
    id, type: 'email.received', from: { address: 'a@b.com' }, to: [{ address: 'me@mailn.app' }],
    subject, text: subject, html: null, threadId: null,
    auth: { spf: null, dkim: null, dmarc: null, spam: null }, attachments: [],
  }
}

async function seed() {
  const repo = new MailRepo(new SqliteDriver(':memory:'), blobs)
  await repo.migrate()
  const fetchAttachment = async () => new Uint8Array()
  await repo.ingestWebhookMessage(payload('m1', 'Invoice 2024'), { now: 1000, fetchAttachment })
  await repo.ingestWebhookMessage(payload('m2', 'Welcome aboard'), { now: 2000, fetchAttachment })
  return repo
}

describe('organize & search', () => {
  it('toggles flags, filters by folder, and searches', async () => {
    const repo = await seed()
    expect((await repo.listMessages(ADMIN)).length).toBe(2) // inbox

    await repo.updateFlags(ADMIN, 'm1', { archived: true })
    expect((await repo.listMessages(ADMIN)).length).toBe(1) // inbox hides archived
    expect((await repo.listMessages(ADMIN, { folder: 'archive' })).map((m) => m.id)).toEqual(['m1'])

    await repo.updateFlags(ADMIN, 'm2', { starred: true, unread: false })
    expect((await repo.listMessages(ADMIN, { folder: 'starred' })).map((m) => m.id)).toEqual(['m2'])

    expect((await repo.listMessages(ADMIN, { q: 'welcome' })).map((m) => m.id)).toEqual(['m2'])
    expect((await repo.listMessages(ADMIN, { folder: 'archive', q: 'invoice' })).map((m) => m.id)).toEqual(['m1'])

    const m2 = await repo.getMessage(ADMIN, 'm2')
    expect(m2?.unread).toBe(0)
    expect(m2?.starred).toBe(1)
  })
})
