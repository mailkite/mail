import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import { createApp, type AppDeps } from '../src/app'

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(extra: Partial<AppDeps['env']> = {}, sendEmail?: AppDeps['sendEmail']) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  const app = createApp({ repo, env: { ...extra }, sessionSecret: 'sess_test', sendEmail })
  return { app, repo }
}

async function json(res: Response) { return res.json() as Promise<Record<string, unknown>> }
const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const post = (app: Awaited<ReturnType<typeof makeApp>>['app'], path: string, body: unknown, cookie?: string) =>
  app.fetch(new Request(`http://x${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }))

describe('signup → email code → verify', () => {
  it('emails a code, blocks login until verified, and makes the first user an admin', async () => {
    let sentText = ''
    const { app } = await makeApp(
      { apiKey: 'mk_test', from: 'noreply@x' },
      async (input) => { sentText = String(input.text ?? ''); return { id: 'out', status: 'queued' } },
    )

    // signup emails a 6-digit code
    const signup = await post(app, '/api/admin/signup', { email: 'Me@X.com', password: 'hunter2!' })
    expect(signup.status).toBe(201)
    const code = sentText.match(/\b(\d{6})\b/)?.[1]
    expect(code).toBeTruthy()

    // login before verify is refused as unverified
    const early = await post(app, '/api/admin/login', { email: 'me@x.com', password: 'hunter2!' })
    expect(early.status).toBe(403)
    expect((await json(early)).code).toBe('unverified')

    // wrong code rejected; right code activates + sessions, first user is admin
    expect((await post(app, '/api/admin/verify', { email: 'me@x.com', code: '000000' })).status).toBe(400)
    const verify = await post(app, '/api/admin/verify', { email: 'me@x.com', code })
    expect(verify.status).toBe(200)
    expect((await json(verify)).role).toBe('admin')

    // verified password login now works
    expect((await post(app, '/api/admin/login', { email: 'me@x.com', password: 'hunter2!' })).status).toBe(200)
  })
})

describe('team invites + gating', () => {
  it('admin invites; invited email can sign up; uninvited is rejected', async () => {
    let sentText = ''
    const { app } = await makeApp(
      { adminEmail: 'admin@x', adminPassword: 'pw', apiKey: 'mk', from: 'no@x' },
      async (input) => { sentText = String(input.text ?? ''); return { id: 'o', status: 'queued' } },
    )
    const adminCookie = cookieOf(await post(app, '/api/admin/login', { email: 'admin@x', password: 'pw' }))

    // an uninvited signup is rejected (an admin/users exist via env-admin? env-admin isn't a row)
    // seed a real admin row so countUsers > 0
    await post(app, '/api/admin/users', { email: 'mate@x.com', role: 'user' }, adminCookie)
    const list1 = (await json(await app.fetch(new Request('http://x/api/admin/users', { headers: { cookie: adminCookie } })))).users as Array<{ email: string; status: string }>
    expect(list1.find((u) => u.email === 'mate@x.com')?.status).toBe('invited')

    // uninvited → 403
    expect((await post(app, '/api/admin/signup', { email: 'random@x.com', password: 'longenough' })).status).toBe(403)

    // invited → signup works → code → verify → active (role preserved as member)
    expect((await post(app, '/api/admin/signup', { email: 'mate@x.com', password: 'longenough' })).status).toBe(201)
    const code = sentText.match(/\b(\d{6})\b/)?.[1]
    const verify = await post(app, '/api/admin/verify', { email: 'mate@x.com', code })
    expect(verify.status).toBe(200)
    expect((await json(verify)).role).toBe('user')

    // non-admin can't list users
    const mateCookie = cookieOf(verify)
    expect((await app.fetch(new Request('http://x/api/admin/users', { headers: { cookie: mateCookie } }))).status).toBe(403)
  })
})

describe('delete account', () => {
  it('lets an admin delete themselves while others remain, but blocks the final admin', async () => {
    let sentText = ''
    const { app, repo } = await makeApp(
      { apiKey: 'mk', from: 'no@x' },
      async (input) => { sentText = String(input.text ?? ''); return { id: 'o', status: 'queued' } },
    )
    const activate = async (email: string) => {
      await post(app, '/api/admin/signup', { email, password: 'longenough' })
      const code = sentText.match(/\b(\d{6})\b/)?.[1]
      return cookieOf(await post(app, '/api/admin/verify', { email, code }))
    }

    // first signup becomes admin; that admin invites a second admin, who activates
    const bossCookie = await activate('boss@x.com')
    await post(app, '/api/admin/users', { email: 'second@x.com', role: 'admin' }, bossCookie)
    const secondCookie = await activate('second@x.com')

    // unauthenticated delete is refused
    expect((await post(app, '/api/admin/account/delete', {})).status).toBe(401)

    // one of two admins can delete their own account
    expect((await post(app, '/api/admin/account/delete', {}, bossCookie)).status).toBe(200)
    expect(await repo.getUserByEmail('boss@x.com')).toBeUndefined()

    // the remaining admin is the last one — blocked, account preserved
    const blocked = await post(app, '/api/admin/account/delete', {}, secondCookie)
    expect(blocked.status).toBe(400)
    expect(String((await json(blocked)).error)).toContain('only admin')
    expect(await repo.getUserByEmail('second@x.com')).toBeDefined()
  })
})

describe('admin config', () => {
  it('is role-gated; env-first with a saved fallback; gates sending', async () => {
    const { app } = await makeApp({ adminEmail: 'admin@x', adminPassword: 'pw' }) // no apiKey in env
    expect((await app.fetch(new Request('http://x/api/admin/config'))).status).toBe(401)

    const cookie = cookieOf(await post(app, '/api/admin/login', { email: 'admin@x', password: 'pw' }))
    const cfg = await json(await app.fetch(new Request('http://x/api/admin/config', { headers: { cookie } })))
    expect((cfg.items as Array<{ key: string; source: string }>).find((i) => i.key === 'MAILKITE_API_KEY')?.source).toBe('unset')

    await post(app, '/api/admin/config', { key: 'MAILKITE_API_KEY', value: 'mk_live_abcd' }, cookie)
    const cfg2 = await json(await app.fetch(new Request('http://x/api/admin/config', { headers: { cookie } })))
    const item = (cfg2.items as Array<{ key: string; source: string; value: string }>).find((i) => i.key === 'MAILKITE_API_KEY')!
    expect(item.source).toBe('saved')
    expect(item.value).toContain('••••')
    expect((await json(await app.fetch(new Request('http://x/api/config')))).sending).toBe(true)

    // wrong password rejected
    expect((await post(app, '/api/admin/login', { email: 'admin@x', password: 'nope' })).status).toBe(401)
  })
})
