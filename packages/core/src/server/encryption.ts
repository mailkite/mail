// Per-account at-rest encryption (opt-in, v1). A hybrid WebCrypto envelope: a fresh AES-256-GCM
// content key encrypts each body, wrapped with the account holder's RSA-OAEP (SHA-256) public key.
// Zero dependencies — pure WebCrypto, so it runs identically on Node 22 and Cloudflare Workers.
//
// MailKite Mail only ever holds the PUBLIC key, so it can encrypt but never decrypt — zero-knowledge
// at rest. The account holder decrypts in their browser with the matching private key (see
// packages/ui/src/lib/envelope.ts). This is a faithful port of the MailKite platform's shipped v1
// (`api/src/lib/encryption.ts`); see docs/architecture.md §1.1 for why the own store encrypts.

export const ENC_ALG = 'RSA-OAEP-256'

// The stored/serialized envelope. All binary fields are base64. `fp` records which public key the
// content key was wrapped to, so key rotation stays decryptable (old mail keeps its old fp).
export interface Envelope {
  v: 1
  keyAlg: typeof ENC_ALG
  fp: string
  enc: 'A256GCM'
  iv: string // base64, 12 bytes
  wrappedKey: string // base64, RSA-OAEP(rawAesKey)
  ciphertext: string // base64, AES-GCM output (includes the auth tag)
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}
// Returns Uint8Array<ArrayBuffer> (not ArrayBufferLike) so the bytes satisfy WebCrypto's BufferSource
// parameter type under TS 5.7's stricter typed-array generics.
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(s))

// Strip a PEM wrapper to its base64 DER body. Accepts "PUBLIC KEY" (SPKI) blocks.
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('empty or malformed PEM')
  return b64ToBytes(body)
}

export interface ParsedPublicKey {
  key: CryptoKey
  alg: typeof ENC_ALG
  fingerprint: string // sha256 of the SPKI DER, lowercase hex
}

// Parse + validate an account-supplied RSA public key (SPKI PEM). Enforces RSA ≥ 2048-bit. Throws a
// human-readable error on anything we can't use, so the API can 400 cleanly.
export async function parsePublicKey(pem: string): Promise<ParsedPublicKey> {
  if ((pem ?? '').includes('PRIVATE KEY')) {
    throw new Error('That is a PRIVATE key — paste your PUBLIC key only. MailKite Mail never holds private keys.')
  }
  let der: Uint8Array<ArrayBuffer>
  try {
    der = pemToDer(pem)
  } catch {
    throw new Error('Could not read the key — paste a PEM-encoded RSA public key (-----BEGIN PUBLIC KEY-----).')
  }
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
  } catch {
    throw new Error('Not a valid RSA public key in SPKI/PEM format.')
  }
  const modulusLength = (key.algorithm as { modulusLength?: number }).modulusLength ?? 0
  if (modulusLength < 2048) throw new Error('RSA key is too small — use at least 2048-bit.')
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der))
  const fingerprint = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { key, alg: ENC_ALG, fingerprint }
}

// Encrypt bytes to a parsed public key, returning the envelope.
export async function encryptBytes(pk: ParsedPublicKey, data: Uint8Array<ArrayBuffer>): Promise<Envelope> {
  const contentKey = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])) as CryptoKey
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, contentKey, data))
  const rawKey = new Uint8Array((await crypto.subtle.exportKey('raw', contentKey)) as ArrayBuffer)
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pk.key, rawKey))
  return {
    v: 1,
    keyAlg: pk.alg,
    fp: pk.fingerprint,
    enc: 'A256GCM',
    iv: bytesToB64(iv),
    wrappedKey: bytesToB64(wrapped),
    ciphertext: bytesToB64(ct),
  }
}

// Encrypt a UTF-8 string, returning the envelope serialized as a compact JSON string (what we store
// in a text column). Null/empty passes through untouched (nothing to protect).
export async function encryptString(pk: ParsedPublicKey, text: string | null | undefined): Promise<string | null> {
  if (text == null || text === '') return text ?? null
  const env = await encryptBytes(pk, utf8(text))
  return JSON.stringify(env)
}

// ---- Decryption — used by tests here and published verbatim to account holders as the reference
// implementation. We never call it in production (we don't hold the private key).
export async function decryptBytes(privateKey: CryptoKey, env: Envelope): Promise<Uint8Array> {
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(env.wrappedKey))
  const contentKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, contentKey, b64ToBytes(env.ciphertext))
  return new Uint8Array(pt)
}
export async function decryptString(privateKey: CryptoKey, envJson: string): Promise<string> {
  const env = JSON.parse(envJson) as Envelope
  return new TextDecoder().decode(await decryptBytes(privateKey, env))
}
