import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore, type SendInput, type SendResult } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import type { WebhookPayload, MessageRow } from '@mailkite/core'
import { createApp, type AppDeps } from '../src/app'

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(opts: { sendEmail?: (i: SendInput) => Promise<SendResult>; env?: Partial<AppDeps['env']> } = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  const app = createApp({
    repo,
    env: { adminEmail: 'admin@x', adminPassword: 'pw', apiKey: 'test-key', from: 'me@myco.dev', ...opts.env },
    sessionSecret: 'sess_test',
    sendEmail: opts.sendEmail,
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

const adminLogin = (app: Awaited<ReturnType<typeof makeApp>>['app']) =>
  post(app, '/api/admin/login', { email: 'admin@x', password: 'pw' }).then(cookieOf)

async function seedInbound(repo: MailRepo, over: Partial<WebhookPayload> = {}): Promise<MessageRow> {
  const payload: WebhookPayload = {
    id: 'evt_lunch', type: 'email.received',
    from: { address: 'alice@example.com' }, to: [{ address: 'me@myco.dev' }],
    subject: 'Lunch tomorrow?', text: 'Are you free for lunch at noon?', html: null,
    threadId: 'thr_1', auth: { spf: null, dkim: null, dmarc: null, spam: null }, attachments: [],
    ...over,
  }
  // Seed in the past so a reply (server-stamped "now") is unambiguously newer —
  // the collapsed list represents a thread by its newest message.
  await repo.ingestWebhookMessage(payload, { now: Date.now() - 60_000, fetchAttachment: async () => new Uint8Array(), addressMode: 'open' })
  const all = await repo.listMessages({ userId: 'env-admin', isAdmin: true })
  return all.find((m) => m.thread_id === (payload.threadId ?? payload.id))!
}

describe('threading', () => {
  it('a sent reply persists into the same thread as an outbound message', async () => {
    let sent: SendInput | null = null
    const { app, repo } = await makeApp({ sendEmail: async (i) => { sent = i; return { id: 'out_1', status: 'queued' } } })
    const cookie = await adminLogin(app)
    const inbound = await seedInbound(repo)

    const res = await post(app, '/api/send', {
      from: 'me@myco.dev', to: 'alice@example.com', subject: 'Re: Lunch tomorrow?', text: 'Noon works!', inReplyTo: inbound.id,
    }, cookie)
    expect(res.status).toBe(201)
    const body = (await json(res)) as { id: string; message?: MessageRow }
    expect(sent).not.toBeNull()
    expect(body.message?.direction).toBe('outbound')
    expect(body.message?.thread_id).toBe(inbound.thread_id)
    expect(body.message?.text_body).toBe('Noon works!')
  })

  it('GET /thread returns the whole conversation oldest→newest', async () => {
    const { app, repo } = await makeApp({ sendEmail: async () => ({ id: 'out_1', status: 'queued' }) })
    const cookie = await adminLogin(app)
    const inbound = await seedInbound(repo)
    await post(app, '/api/send', { from: 'me@myco.dev', to: 'alice@example.com', subject: 'Re: Lunch', text: 'Noon works!', inReplyTo: inbound.id }, cookie)

    const thread = (await json(await get(app, `/api/messages/${inbound.id}/thread`, cookie))).messages as MessageRow[]
    expect(thread).toHaveLength(2)
    expect(thread[0].direction).toBe('inbound')
    expect(thread[1].direction).toBe('outbound')
    expect(thread[1].received_at).toBeGreaterThanOrEqual(thread[0].received_at)
  })

  it('the list collapses to one row per thread and reports thread_count', async () => {
    const { app, repo } = await makeApp({ sendEmail: async () => ({ id: 'out_1', status: 'queued' }) })
    const cookie = await adminLogin(app)
    const inbound = await seedInbound(repo)
    await seedInbound(repo, { id: 'evt_other', threadId: 'thr_2', subject: 'Different thread' })
    await post(app, '/api/send', { from: 'me@myco.dev', to: 'alice@example.com', subject: 'Re: Lunch', text: 'Noon works!', inReplyTo: inbound.id }, cookie)

    const list = (await json(await get(app, '/api/messages', cookie))).messages as MessageRow[]
    expect(list).toHaveLength(2) // two threads, not three messages
    const lunch = list.find((m) => m.thread_id === 'thr_1')!
    expect(lunch.thread_count).toBe(2)
    expect(lunch.direction).toBe('outbound') // representative is the newest message
    expect(list.find((m) => m.thread_id === 'thr_2')!.thread_count).toBe(1)
  })

  it('archiving a thread files every message in it', async () => {
    const { app, repo } = await makeApp({ sendEmail: async () => ({ id: 'out_1', status: 'queued' }) })
    const cookie = await adminLogin(app)
    const inbound = await seedInbound(repo)
    await post(app, '/api/send', { from: 'me@myco.dev', to: 'alice@example.com', subject: 'Re: Lunch', text: 'Noon works!', inReplyTo: inbound.id }, cookie)

    expect((await patch(app, `/api/threads/${inbound.thread_id}`, { archived: true }, cookie)).status).toBe(200)
    const inbox = (await json(await get(app, '/api/messages', cookie))).messages as MessageRow[]
    expect(inbox).toHaveLength(0)
    const archived = (await json(await get(app, '/api/messages?folder=archive', cookie))).messages as MessageRow[]
    expect(archived).toHaveLength(1)
    expect(archived[0].thread_count).toBe(2)
  })
})
