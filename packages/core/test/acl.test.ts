import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '../src/server/index'
import { SqliteDriver } from '../src/server/node'
import type { WebhookPayload } from '../src/index'

const blobs: BlobStore = { async put() {}, async get() { return null } }
const ADMIN = { userId: 'sys', isAdmin: true }
const member = (id: string) => ({ userId: id, isAdmin: false })

function msg(id: string, to: string, subject: string): WebhookPayload {
  return {
    id, type: 'email.received', from: { address: 'sender@out.com' }, to: [{ address: to }],
    subject, text: subject, html: null, threadId: null,
    auth: { spf: null, dkim: null, dmarc: null, spam: null }, attachments: [],
  }
}

async function seed() {
  const repo = new MailRepo(new SqliteDriver(':memory:'), blobs)
  await repo.migrate()
  const fetchAttachment = async () => new Uint8Array()
  await repo.ingestWebhookMessage(msg('s1', 'support@x.com', 'Support ticket'), { now: 1000, fetchAttachment })
  await repo.ingestWebhookMessage(msg('a1', 'alice@x.com', 'Personal note'), { now: 2000, fetchAttachment })
  return repo
}

describe('ACL — address-scoped access (deny-by-default)', () => {
  it('admin sees all; a member sees only granted addresses (direct + team); writes are scoped', async () => {
    const repo = await seed()
    const support = (await repo.getAddressByName('support@x.com'))!
    const alice = (await repo.getAddressByName('alice@x.com'))!

    // admin (owner) sees everything
    expect((await repo.listMessages(ADMIN)).map((m) => m.id).sort()).toEqual(['a1', 's1'])

    // u1 granted support@ directly → sees ONLY support@'s mail
    await repo.grantAddressToUser(support.id, 'u1', 3000)
    expect((await repo.listMessages(member('u1'))).map((m) => m.id)).toEqual(['s1'])
    expect(await repo.getMessage(member('u1'), 's1')).toBeDefined()
    expect(await repo.getMessage(member('u1'), 'a1')).toBeUndefined() // IDOR closed
    expect(await repo.listIdentities(member('u1'))).toEqual(['support@x.com'])

    // u2 has no grants → deny-by-default (empty, never a dump)
    expect(await repo.listMessages(member('u2'))).toEqual([])
    expect(await repo.getMessage(member('u2'), 's1')).toBeUndefined()
    expect(await repo.listIdentities(member('u2'))).toEqual([])

    // u3 granted alice@ via a team → sees ONLY alice@'s mail
    await repo.createTeam({ id: 't1', name: 'Personal', created_at: 4000 })
    await repo.addTeamMember('t1', 'u3')
    await repo.grantAddressToTeam(alice.id, 't1', 4000)
    expect((await repo.listMessages(member('u3'))).map((m) => m.id)).toEqual(['a1'])
    expect(await repo.getMessage(member('u3'), 's1')).toBeUndefined()

    // write-path: u2 cannot flag a message it can't see (0 rows changed)
    await repo.updateFlags(member('u2'), 's1', { starred: true })
    expect((await repo.getMessage(ADMIN, 's1'))!.starred).toBe(0)
    // but u1 can flag its own
    await repo.updateFlags(member('u1'), 's1', { starred: true })
    expect((await repo.getMessage(ADMIN, 's1'))!.starred).toBe(1)

    // revoking u1's grant removes access immediately (predicate reads grants live)
    await repo.revokeUserGrant(support.id, 'u1')
    expect(await repo.listMessages(member('u1'))).toEqual([])
  })
})
