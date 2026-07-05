// The at-rest envelope format + detection come from the shared MailKite SDK (@mailkite/client) — one
// implementation, every SDK. What the SDK does NOT offer, and what this file adds, are the two
// browser-security helpers our decryption model needs: importing the private key as a
// NON-EXTRACTABLE CryptoKey (so its bytes can never be read back out or persisted as a PEM) and
// decrypting with that held key. The SDK's decrypt takes a PEM string, which we deliberately avoid
// holding. See lib/decryption-keys.tsx and docs/architecture.md §1.1.
export { parseEnvelope, type Envelope } from '@mailkite/client'
import type { Envelope } from '@mailkite/client'

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Import an RSA private key from PEM (PKCS#8). extractable=false, so the key can decrypt but its bytes
// can never be read back out by script (`exportKey` rejects) — which is what lets us persist it in
// IndexedDB safely (see key-vault.ts). Throws a human-readable error the UI can show verbatim.
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  if (!body) throw new Error('Paste a PEM private key (-----BEGIN PRIVATE KEY-----).')
  let der: Uint8Array<ArrayBuffer>
  try {
    der = b64ToBytes(body)
  } catch {
    throw new Error('Could not read the key — is it a PEM-encoded PKCS#8 private key?')
  }
  try {
    return await crypto.subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
  } catch {
    throw new Error('Not a usable RSA private key in PKCS#8/PEM format.')
  }
}

// Decrypt one envelope with an already-imported RSA private key (the non-extractable CryptoKey from
// importPrivateKey), returning the UTF-8 plaintext. All in this tab; the key never leaves the browser.
// A wrong key surfaces as a decrypt failure (OAEP/GCM throws). The key store holds one CryptoKey per
// fingerprint and decrypts every matching message with it.
export async function decryptEnvelopeWithKey(privateKey: CryptoKey, env: Envelope): Promise<string> {
  let rawKey: ArrayBuffer
  try {
    rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(env.wrappedKey))
  } catch {
    throw new Error("This key can't unwrap the message — it doesn't match the key it was encrypted to.")
  }
  const contentKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  let pt: ArrayBuffer
  try {
    pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, contentKey, b64ToBytes(env.ciphertext))
  } catch {
    throw new Error('Decryption failed — the ciphertext or key is wrong.')
  }
  return new TextDecoder().decode(pt)
}

// Decrypt one envelope with a PEM private key (imports then delegates). Kept for the one-shot
// paste-and-decrypt path; persistent unlock uses importPrivateKey + decryptEnvelopeWithKey.
export async function decryptEnvelope(privateKeyPem: string, env: Envelope): Promise<string> {
  return decryptEnvelopeWithKey(await importPrivateKey(privateKeyPem), env)
}
