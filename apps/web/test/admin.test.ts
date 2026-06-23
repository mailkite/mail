import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import { createApp, type AppDeps } from '../src/app'

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(extra: Partial<AppDeps['env']> = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  const app = createApp({ repo, env: { ...extra }, sessionSecret: 'sess_test' })
  return { app, repo }
}

async function json(res: Response) { return res.json() as Promise<Record<string, unknown>> }

describe('admin & setup', () => {
  it('reports needsSetup, runs the wizard, and gates admin config by role', async () => {
    const { app } = await makeApp() // no admin env, no users → needs setup
    expect((await json(await app.fetch(new Request('http://x/api/config')))).needsSetup).toBe(true)

    // admin config blocked without auth
    expect((await app.fetch(new Request('http://x/api/admin/config'))).status).toBe(401)

    // run setup → creates admin + session
    const setup = await app.fetch(new Request('http://x/api/admin/setup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'me@x', password: 'hunter2' }),
    }))
    expect(setup.status).toBe(201)
    const cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0]

    // now setup is complete
    expect((await json(await app.fetch(new Request('http://x/api/config')))).needsSetup).toBe(false)
    // second setup attempt is refused
    expect((await app.fetch(new Request('http://x/api/admin/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@x', password: 'y' }) }))).status).toBe(409)

    // admin config now reachable + shows masked/unset status
    const cfg = await json(await app.fetch(new Request('http://x/api/admin/config', { headers: { cookie } })))
    const items = cfg.items as Array<{ key: string; source: string }>
    expect(items.find((i) => i.key === 'MAILKITE_API_KEY')?.source).toBe('unset')

    // save a value, see it reflected as "saved"
    await app.fetch(new Request('http://x/api/admin/config', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ key: 'MAILKITE_API_KEY', value: 'mk_live_abcd' }) }))
    const cfg2 = await json(await app.fetch(new Request('http://x/api/admin/config', { headers: { cookie } })))
    const item = (cfg2.items as Array<{ key: string; source: string; value: string }>).find((i) => i.key === 'MAILKITE_API_KEY')!
    expect(item.source).toBe('saved')
    expect(item.value).toContain('••••') // masked
    // and sending capability now true (resolved from saved setting)
    expect((await json(await app.fetch(new Request('http://x/api/config')))).sending).toBe(true)
  })

  it('env-admin can log in and env config wins as source', async () => {
    const { app } = await makeApp({ adminEmail: 'admin@x', adminPassword: 'pw', apiKey: 'mk_env_key' })
    expect((await json(await app.fetch(new Request('http://x/api/config')))).needsSetup).toBe(false)
    const login = await app.fetch(new Request('http://x/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@x', password: 'pw' }) }))
    expect(login.status).toBe(200)
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
    const cfg = await json(await app.fetch(new Request('http://x/api/admin/config', { headers: { cookie } })))
    expect((cfg.items as Array<{ key: string; source: string }>).find((i) => i.key === 'MAILKITE_API_KEY')?.source).toBe('env')
    // wrong password rejected
    expect((await app.fetch(new Request('http://x/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@x', password: 'nope' }) }))).status).toBe(401)
  })
})
