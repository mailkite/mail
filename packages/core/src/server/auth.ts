// Isomorphic auth primitives (Web Crypto) — run unchanged on Node and Workers.

const enc = new TextEncoder()
const ITERATIONS = 100_000

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** PBKDF2-SHA256 password hash, encoded `pbkdf2$<iter>$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256)
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltS, hashS] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iter || !saltS || !hashS) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(saltS), iterations: Number(iter), hash: 'SHA-256' }, key, 256,
  )
  return b64(bits) === hashS
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Fast one-way hash for short-lived codes/tokens (OTP) — not for passwords. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SessionPayload {
  uid: string
  role: 'admin' | 'user'
  email: string
  exp: number
}

/** Sign a session as `<base64(json)>.<hmac>`. */
export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(payload)))
  return `${body}.${await hmacHex(secret, body)}`
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  if ((await hmacHex(secret, body)) !== sig) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64(body))) as SessionPayload
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}
