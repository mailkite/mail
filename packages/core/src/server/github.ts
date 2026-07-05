// GitHub sign-in — server-side authorization-code (redirect) flow, mirroring
// google.ts. Parameterized by client id/secret so it stays isomorphic (Node +
// Workers) and config-driven.
//
// The SPA sends the user to GitHub with our client id + redirect_uri; GitHub
// returns a one-time `code` which the SPA POSTs to /api/auth/github. We exchange
// it for an access token (confidential client), then read the user's profile and
// their verified primary email over TLS from the GitHub API. GitHub doesn't issue
// an ID token, so identity comes from those authenticated API calls.

const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails'
// GitHub's API rejects requests without a User-Agent.
const UA = 'MailKite-Mail'

export interface GitHubIdentity {
  sub: string // GitHub's stable numeric user id (as a string)
  email: string | null // verified primary email, if any
  name: string | null
  picture: string | null
}

/** Exchange an authorization code for an access token. Returns it, or null. */
export async function exchangeGitHubCode(opts: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code: opts.code,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        redirect_uri: opts.redirectUri,
      }).toString(),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { access_token?: string }
    return body.access_token ?? null
  } catch {
    return null
  }
}

/** Fetch the authenticated user's profile + verified primary email. */
export async function fetchGitHubIdentity(accessToken: string): Promise<GitHubIdentity | null> {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/vnd.github+json',
    'user-agent': UA,
  }
  try {
    const userRes = await fetch(GITHUB_USER_URL, { headers })
    if (!userRes.ok) return null
    const u = (await userRes.json()) as {
      id?: number
      name?: string | null
      login?: string
      email?: string | null
      avatar_url?: string | null
    }
    if (u.id == null) return null

    // The profile email is often null/unverified; read the verified primary from /user/emails.
    let email = u.email ?? null
    try {
      const emailsRes = await fetch(GITHUB_EMAILS_URL, { headers })
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as {
          email: string
          primary: boolean
          verified: boolean
        }[]
        const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified)
        if (primary) email = primary.email
      }
    } catch {
      // fall back to the profile email
    }

    return {
      sub: String(u.id),
      email: email ? email.toLowerCase() : null,
      name: u.name ?? u.login ?? null,
      picture: u.avatar_url ?? null,
    }
  } catch {
    return null
  }
}
