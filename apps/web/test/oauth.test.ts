import { describe, it, expect } from 'vitest'
import { MailRepo, type BlobStore } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'
import { createApp, type AppDeps } from '../src/app'

const memBlobs: BlobStore = { async put() {}, async get() { return null } }

async function makeApp(env: AppDeps['env'] = {}) {
  const repo = new MailRepo(new SqliteDriver(':memory:'), memBlobs)
  await repo.migrate()
  return { app: createApp({ repo, env, sessionSecret: 'sess' }), repo }
}
const cfg = async (app: Awaited<ReturnType<typeof makeApp>>['app']) =>
  (await app.fetch(new Request('http://x/api/config'))).json() as Promise<Record<string, unknown>>
const postGoogle = (app: Awaited<ReturnType<typeof makeApp>>['app'], body: unknown) =>
  app.fetch(new Request('http://x/api/auth/google', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

describe('Google OAuth — config gating', () => {
  it('oauth=false and client id hidden when unconfigured; endpoint 503s', async () => {
    const { app } = await makeApp()
    const c = await cfg(app)
    expect(c.oauth).toBe(false)
    expect(c.googleClientId).toBe('')
    expect((await postGoogle(app, { code: 'x', redirectUri: 'y' })).status).toBe(503)
  })

  it('oauth=true and public client id exposed when configured; bad request 400s', async () => {
    const { app } = await makeApp({ googleClientId: 'cid.apps.googleusercontent.com', googleClientSecret: 's' })
    const c = await cfg(app)
    expect(c.oauth).toBe(true)
    expect(c.googleClientId).toBe('cid.apps.googleusercontent.com')
    expect((await postGoogle(app, {})).status).toBe(400) // configured but no code
  })
})

describe('upsertGoogleUser', () => {
  it('makes the first Google user an admin, later ones members, and links existing accounts', async () => {
    const { repo } = await makeApp()
    const first = await repo.upsertGoogleUser({ email: 'a@x.com', sub: 'g1', name: 'A', picture: null })
    expect(first.role).toBe('admin')
    expect(first.provider).toBe('google')
    expect(first.status).toBe('active')

    const second = await repo.upsertGoogleUser({ email: 'b@x.com', sub: 'g2', name: 'B', picture: null })
    expect(second.role).toBe('user')

    // existing email (e.g. a prior password member) gets linked, not duplicated
    await repo.createUser({ id: 'usr_c', email: 'c@x.com', password_hash: 'h', role: 'user', created_at: 1, status: 'active' })
    const linked = await repo.upsertGoogleUser({ email: 'c@x.com', sub: 'g3', name: 'C', picture: null })
    expect(linked.google_sub).toBe('g3')
    expect(await repo.countUsers()).toBe(3)
  })
})
