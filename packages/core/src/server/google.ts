// Google sign-in — server-side authorization-code (redirect) flow. Ported from
// the MailKite dashboard/API (api/src/auth/google.ts), parameterized by client
// id/secret so it stays isomorphic (Node + Workers) and config-driven.
//
// The SPA sends the user to Google with our client id + redirect_uri; Google
// returns a one-time `code` which the SPA POSTs to /api/auth/google. We exchange
// it for tokens (confidential client), decode the ID token, and enforce its
// `aud` is our client id. The token came over TLS from Google's endpoint using
// our secret, so we trust it at the transport layer and decode locally.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface GoogleIdentity {
  sub: string // Google's stable user id
  email: string | null
  emailVerified: boolean
  name: string | null
  picture: string | null
  aud: string | null
}

/** Exchange an authorization code for tokens. Returns the ID token, or null. */
export async function exchangeGoogleCode(opts: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: opts.code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { id_token?: string }
    return body.id_token ?? null
  } catch {
    return null
  }
}

function b64urlToString(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Decode (not re-verify) the ID token payload — trusted because it came
 *  directly from Google's token endpoint via our authenticated exchange. */
export function decodeGoogleIdToken(idToken: string): GoogleIdentity | null {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const p = JSON.parse(b64urlToString(parts[1])) as {
      sub?: string
      email?: string
      email_verified?: boolean
      name?: string
      picture?: string
      aud?: string
    }
    if (!p.sub) return null
    return {
      sub: p.sub,
      email: p.email ?? null,
      emailVerified: p.email_verified === true,
      name: p.name ?? null,
      picture: p.picture ?? null,
      aud: p.aud ?? null,
    }
  } catch {
    return null
  }
}
