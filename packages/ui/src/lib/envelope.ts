// Client-side detection + decryption of the at-rest encryption envelope (RSA-OAEP-256 + AES-256-GCM)
// that the backend stores when the account has a public key set. MailKite Mail is zero-knowledge — it
// only holds the public key — so decryption is the account holder's job and happens entirely in this
// browser tab (the private key is never sent anywhere). Mirrors the production encrypt in
// @mailkite/core/server `encryption.ts`. See docs/architecture.md §1.1.

// The stored envelope shape — matches @mailkite/core/server `Envelope`. All binary fields base64.
export interface Envelope {
  v: 1
  keyAlg: 'RSA-OAEP-256'
  fp: string
  enc: 'A256GCM'
  iv: string
  wrappedKey: string
  ciphertext: string
}

// Sniff a stored body. Bodies are plaintext unless the account has at-rest encryption on, in which
// case the column holds a compact JSON envelope. Returns the parsed envelope or null (plaintext).
// Cheap-guards on the leading `{` so we don't JSON.parse every plaintext body.
export function parseEnvelope(body: string | null | undefined): Envelope | null {
  if (!body || body[0] !== '{') return null
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    return null
  }
  if (
    v != null &&
    typeof v === 'object' &&
    (v as Envelope).v === 1 &&
    (v as Envelope).keyAlg === 'RSA-OAEP-256' &&
    typeof (v as Envelope).wrappedKey === 'string' &&
    typeof (v as Envelope).ciphertext === 'string' &&
    typeof (v as Envelope).iv === 'string'
  ) {
    return v as Envelope
  }
  return null
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Import an RSA private key from PEM (PKCS#8 — the `-----BEGIN PRIVATE KEY-----` block OpenSSL emits).
// Imported with extractable=false, so the key can decrypt but its bytes can never be read back out by
// script (`exportKey` rejects) — which is what lets us persist it in IndexedDB safely (see
// key-vault.ts + decryption-keys.tsx). Throws a human-readable error the UI can show verbatim.
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
