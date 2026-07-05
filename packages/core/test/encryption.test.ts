import { describe, it, expect } from 'vitest'
import { parsePublicKey, encryptString, decryptString } from '../src/server/encryption'
import { MailRepo, type BlobStore } from '../src/server/index'
import { SqliteDriver } from '../src/server/node'
import type { WebhookPayload } from '../src/index'

// Generate an RSA-OAEP keypair and return the public key as SPKI PEM + the private CryptoKey (for the
// reference decrypt), mirroring what an account holder does with `openssl`.
async function makeKeypair() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair
  const spki = new Uint8Array((await crypto.subtle.exportKey('spki', pair.publicKey)) as ArrayBuffer)
  const b64 = btoa(String.fromCharCode(...spki))
  const pem = `-----BEGIN PUBLIC KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PUBLIC KEY-----`
  return { pem, privateKey: pair.privateKey }
}

class MemoryBlobStore implements BlobStore {
  store = new Map<string, Uint8Array>()
  async put(k: string, d: Uint8Array) {
    this.store.set(k, d)
  }
  async get(k: string) {
    return this.store.get(k) ?? null
  }
}

describe('at-rest encryption', () => {
  it('round-trips a string through the envelope with the matching private key', async () => {
    const { pem, privateKey } = await makeKeypair()
    const pk = await parsePublicKey(pem)
    expect(pk.fingerprint).toMatch(/^[0-9a-f]{64}$/)

    const envJson = await encryptString(pk, 'the secret body')
    expect(envJson).not.toBeNull()
    const env = JSON.parse(envJson!)
    expect(env.v).toBe(1)
    expect(env.fp).toBe(pk.fingerprint)
    expect(env.ciphertext).not.toContain('secret') // actually encrypted

    expect(await decryptString(privateKey, envJson!)).toBe('the secret body')
  })

  it('passes null/empty bodies through untouched', async () => {
    const { pem } = await makeKeypair()
    const pk = await parsePublicKey(pem)
    expect(await encryptString(pk, null)).toBeNull()
    expect(await encryptString(pk, '')).toBe('')
  })

  it('rejects a private key or a too-small / malformed key', async () => {
    await expect(parsePublicKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).rejects.toThrow(/PRIVATE/)
    await expect(parsePublicKey('not a key')).rejects.toThrow()
  })

  it('encrypts bodies at ingest but keeps subject/from/to plaintext', async () => {
    const { pem, privateKey } = await makeKeypair()
    const pk = await parsePublicKey(pem)
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
      encryptBody: (t) => encryptString(pk, t),
    })

    const m = await repo.getMessage({ userId: 'sys', isAdmin: true }, 'msg_enc_1')
    expect(m).toBeTruthy()
    // Subject/from/to stay readable so the inbox list works.
    expect(m!.subject).toBe('Quarterly numbers')
    expect(m!.from_addr).toBe('sender@example.com')
    // Bodies are stored as envelopes, not plaintext.
    expect(m!.text_body).not.toContain('revenue')
    expect(m!.html_body).not.toContain('revenue')
    const env = JSON.parse(m!.text_body!)
    expect(env.v).toBe(1)
    expect(env.fp).toBe(pk.fingerprint)
    // The account holder decrypts.
    expect(await decryptString(privateKey, m!.text_body!)).toBe('revenue was $1M')
    expect(await decryptString(privateKey, m!.html_body!)).toBe('<p>revenue was $1M</p>')
  })
})
