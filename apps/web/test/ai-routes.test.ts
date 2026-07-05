import { describe, it, expect } from 'vitest'
import { MailRepo, hashPassword, type BlobStore, type AiRunner } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import type { WebhookPayload } from '@mailkite/core'
import { createApp, type AppDeps } from '../src/app'

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

// A canned model that also counts calls, so tests can prove caching (a cache hit re-runs nothing).
function makeStub() {
  let calls = 0
  const run: AiRunner = async ({ system }) => {
    calls++
    const canned = /reply options/.test(system)
      ? '["Sounds good","Can we talk?","Not now"]'
      : /action items/.test(system)
        ? '["Confirm lunch","Reply by noon"]'
        : /Summarize/.test(system)
          ? 'Alice is asking to meet for lunch tomorrow.'
          : 'Here is a drafted reply.'
    return { text: canned, provider: 'Stub', model: 'stub' }
  }
  return { run, calls: () => calls }
}

async function makeApp(opts: { aiComplete?: AiRunner; env?: Partial<AppDeps['env']> } = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  const app = createApp({
    repo,
    env: { adminEmail: 'admin@x', adminPassword: 'pw', ...opts.env },
    sessionSecret: 'sess_test',
    aiComplete: opts.aiComplete,
  })
  return { app, repo }
}

const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const json = (res: Response) => res.json() as Promise<Record<string, unknown>>
const post = (app: Awaited<ReturnType<typeof makeApp>>['app'], path: string, body: unknown, cookie?: string) =>
  app.fetch(new Request(`http://x${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }))
const patch = (app: Awaited<ReturnType<typeof makeApp>>['app'], path: string, body: unknown, cookie?: string) =>
  app.fetch(new Request(`http://x${path}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
  }))
const get = (app: Awaited<ReturnType<typeof makeApp>>['app'], path: string, cookie?: string) =>
  app.fetch(new Request(`http://x${path}`, { headers: cookie ? { cookie } : {} }))
const del = (app: Awaited<ReturnType<typeof makeApp>>['app'], path: string, cookie?: string) =>
  app.fetch(new Request(`http://x${path}`, { method: 'DELETE', headers: cookie ? { cookie } : {} }))

const adminLogin = (app: Awaited<ReturnType<typeof makeApp>>['app']) =>
  post(app, '/api/admin/login', { email: 'admin@x', password: 'pw' }).then(cookieOf)

async function seedMessage(repo: MailRepo): Promise<string> {
  const payload: WebhookPayload = {
    id: 'evt_lunch', type: 'email.received',
    from: { address: 'alice@example.com' }, to: [{ address: 'me@myco.dev' }],
    subject: 'Lunch tomorrow?', text: 'Are you free for lunch tomorrow at noon? Please confirm.', html: null,
    threadId: null, auth: { spf: null, dkim: null, dmarc: null, spam: null }, attachments: [],
  }
  await repo.ingestWebhookMessage(payload, { now: Date.now(), fetchAttachment: async () => new Uint8Array(), addressMode: 'open' })
  const [m] = await repo.listMessages({ userId: 'env-admin', isAdmin: true })
  return m.id
}

describe('/api/ai/* — summary + smart replies + chat', () => {
  it('returns well-shaped output and caches it (a second call re-runs nothing)', async () => {
    const stub = makeStub()
    const { app, repo } = await makeApp({ aiComplete: stub.run })
    const cookie = await adminLogin(app)
    const id = await seedMessage(repo)

    const summary = await post(app, '/api/ai/summary', { messageId: id }, cookie)
    expect(summary.status).toBe(200)
    expect((await json(summary)).summary).toBe('Alice is asking to meet for lunch tomorrow.')

    const replies = await post(app, '/api/ai/smart-replies', { messageId: id }, cookie)
    expect((await json(replies)).replies).toEqual(['Sounds good', 'Can we talk?', 'Not now'])

    const chat = await post(app, '/api/ai/assistant', { messageId: id, messages: [{ role: 'user', content: 'Draft a yes.' }] }, cookie)
    expect((await json(chat)).reply).toBe('Here is a drafted reply.')

    const callsAfterFirst = stub.calls()
    // Repeat summary + replies: served from ai_cache, no new model calls.
    await post(app, '/api/ai/summary', { messageId: id }, cookie)
    await post(app, '/api/ai/smart-replies', { messageId: id }, cookie)
    expect(stub.calls()).toBe(callsAfterFirst)
  })

  it('is ACL-scoped: a member with no grant gets 404', async () => {
    const stub = makeStub()
    const { app, repo } = await makeApp({ aiComplete: stub.run })
    const id = await seedMessage(repo)
    await repo.createUser({ id: 'usr_member', email: 'mate@x.com', password_hash: await hashPassword('longenough'), role: 'user', created_at: Date.now(), provider: 'password', status: 'active' })
    const cookie = cookieOf(await post(app, '/api/admin/login', { email: 'mate@x.com', password: 'longenough' }))
    expect((await post(app, '/api/ai/summary', { messageId: id }, cookie)).status).toBe(404)
  })

  it('validates input and requires auth', async () => {
    const stub = makeStub()
    const { app, repo } = await makeApp({ aiComplete: stub.run })
    const cookie = await adminLogin(app)
    await seedMessage(repo)
    expect((await post(app, '/api/ai/summary', {}, cookie)).status).toBe(400)
    expect((await post(app, '/api/ai/assistant', { messages: [] }, cookie)).status).toBe(400)
    expect((await post(app, '/api/ai/summary', { messageId: 'x' })).status).toBe(401)
  })

  it('gates on a provider: 503 when neither a key nor a stub is set', async () => {
    const { app, repo } = await makeApp() // no aiComplete, no keys
    const cookie = await adminLogin(app)
    const id = await seedMessage(repo)
    expect((await post(app, '/api/ai/summary', { messageId: id }, cookie)).status).toBe(503)
  })

  it('/api/config advertises the assistant + provider label', async () => {
    const { app } = await makeApp({ env: { anthropicApiKey: 'sk-ant-api-xyz' } })
    const cfg = await json(await get(app, '/api/config'))
    expect(cfg.assistant).toBe(true)
    expect(cfg.assistantProvider).toBe('Claude')
    const { app: off } = await makeApp()
    const cfgOff = await json(await get(off, '/api/config'))
    expect(cfgOff.assistant).toBe(false)
    expect(cfgOff.assistantProvider).toBe('')
  })
})

describe('/api/todos — AI-seeded, user-owned, persisted', () => {
  it('auto-seeds from the AI once, then supports add / check / edit / delete', async () => {
    const stub = makeStub()
    const { app, repo } = await makeApp({ aiComplete: stub.run })
    const cookie = await adminLogin(app)
    const id = await seedMessage(repo)

    // First GET seeds from the model.
    const seeded = (await json(await get(app, `/api/todos?messageId=${id}`, cookie))).todos as Array<{ id: string; text: string; source: string; done: number }>
    expect(seeded.map((t) => t.text)).toEqual(['Confirm lunch', 'Reply by noon'])
    expect(seeded.every((t) => t.source === 'ai')).toBe(true)

    const callsAfterSeed = stub.calls()
    // Second GET does NOT re-seed (marker set), no new model call.
    const again = (await json(await get(app, `/api/todos?messageId=${id}`, cookie))).todos as unknown[]
    expect(again).toHaveLength(2)
    expect(stub.calls()).toBe(callsAfterSeed)

    // Add a manual to-do.
    const added = (await json(await post(app, '/api/todos', { messageId: id, text: 'Book a table' }, cookie))).todo as { id: string; source: string }
    expect(added.source).toBe('user')

    // Check one off.
    const checked = (await json(await patch(app, `/api/todos/${seeded[0].id}`, { done: true }, cookie))).todo as { done: number }
    expect(checked.done).toBe(1)

    // Edit text.
    const edited = (await json(await patch(app, `/api/todos/${seeded[1].id}`, { text: 'Reply by 11am' }, cookie))).todo as { text: string }
    expect(edited.text).toBe('Reply by 11am')

    // Delete one.
    expect((await del(app, `/api/todos/${added.id}`, cookie)).status).toBe(200)
    const final = (await json(await get(app, `/api/todos?messageId=${id}`, cookie))).todos as unknown[]
    expect(final).toHaveLength(2)
  })

  it('scopes to-dos per user (a member cannot read another user\'s list) and ACL-guards the message', async () => {
    const stub = makeStub()
    const { app, repo } = await makeApp({ aiComplete: stub.run })
    const id = await seedMessage(repo)
    await repo.createUser({ id: 'usr_member', email: 'mate@x.com', password_hash: await hashPassword('longenough'), role: 'user', created_at: Date.now(), provider: 'password', status: 'active' })
    const cookie = cookieOf(await post(app, '/api/admin/login', { email: 'mate@x.com', password: 'longenough' }))
    // No grant to the address → 404, never the admin's items.
    expect((await get(app, `/api/todos?messageId=${id}`, cookie)).status).toBe(404)
  })
})
