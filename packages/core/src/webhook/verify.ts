export interface VerifyResult {
  ok: boolean
  reason?: string
}

const encoder = new TextEncoder()

/**
 * Verify a MailKite webhook signature header of the form
 * `t=<unix_ms>,v1=<hex_hmac_sha256>`. The signed string is `${t}.${rawBody}`,
 * keyed by the per-account webhook secret. Uses Web Crypto so it runs
 * unchanged on Node and Cloudflare Workers.
 */
export async function verifyWebhookSignature(opts: {
  header: string | null | undefined
  rawBody: string
  secret: string
  now: number
  toleranceMs?: number
}): Promise<VerifyResult> {
  const toleranceMs = opts.toleranceMs ?? 5 * 60 * 1000
  if (!opts.header) return { ok: false, reason: 'missing signature header' }

  const parts: Record<string, string> = {}
  for (const segment of opts.header.split(',')) {
    const eq = segment.indexOf('=')
    if (eq > 0) parts[segment.slice(0, eq).trim()] = segment.slice(eq + 1).trim()
  }
  const t = Number(parts.t)
  const v1 = parts.v1
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: 'malformed signature header' }
  if (Math.abs(opts.now - t) > toleranceMs) return { ok: false, reason: 'timestamp outside tolerance' }

  const expected = await hmacHex(opts.secret, `${t}.${opts.rawBody}`)
  if (!timingSafeEqual(expected, v1)) return { ok: false, reason: 'signature mismatch' }
  return { ok: true }
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
