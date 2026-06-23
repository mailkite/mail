import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, signSession, verifySession } from '../src/server/index'

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const h = await hashPassword('hunter2')
    expect(h.startsWith('pbkdf2$')).toBe(true)
    expect(await verifyPassword('hunter2', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
  })
})

describe('sessions', () => {
  it('round-trips a signed session and rejects tampering / expiry', async () => {
    const secret = 'sess_secret'
    const token = await signSession({ uid: 'u1', role: 'admin', email: 'a@x', exp: Date.now() + 10_000 }, secret)
    const ok = await verifySession(token, secret)
    expect(ok?.role).toBe('admin')
    expect(await verifySession(token, 'other_secret')).toBeNull()
    expect(await verifySession(token + 'x', secret)).toBeNull()
    const expired = await signSession({ uid: 'u1', role: 'user', email: 'a@x', exp: Date.now() - 1 }, secret)
    expect(await verifySession(expired, secret)).toBeNull()
  })
})
