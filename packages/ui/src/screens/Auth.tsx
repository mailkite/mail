import { useState, type FormEvent } from 'react'
import { api, type SessionUser } from '../lib/api'
import { Button } from '../components/Button'
import { ProviderIcon } from '../components/ProviderIcon'
import { AuthScreen, Field } from '../components/auth-ui'

type Mode = 'login' | 'signup' | 'verify'

const UNVERIFIED = /verify your email/i

/**
 * Email + password auth with one-time email verification. Modes:
 *   login  → email/password; an unverified account bounces to `verify`
 *   signup → email/password → emails a code → `verify`
 *   verify → enter the 6-digit code → session
 * `onAuthed` confirms the session stuck (App.confirmSession).
 */
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize'

function startGoogle(clientId: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  })
  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`
}

function startGitHub(clientId: string) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}/auth/github/callback`,
    scope: 'read:user user:email', // read the verified primary email via /user/emails
  })
  window.location.href = `${GITHUB_AUTH_URL}?${params.toString()}`
}

export function Auth({
  initialMode = 'login',
  oauth = false,
  googleClientId = '',
  githubClientId = '',
  appName,
  logoUrl,
  openRegistration = false,
  onAuthed,
}: {
  initialMode?: Mode
  oauth?: boolean
  googleClientId?: string
  githubClientId?: string
  appName?: string
  logoUrl?: string
  openRegistration?: boolean
  onAuthed: (u: SessionUser) => Promise<void>
}) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (mode === 'login') {
      return void run(async () => {
        try {
          await onAuthed(await api.login(addr, password))
        } catch (err) {
          if (err instanceof Error && UNVERIFIED.test(err.message)) {
            setInfo('This email needs verifying. Enter the code we sent (or resend below).')
            setMode('verify')
            return
          }
          throw err
        }
      })
    }
    if (mode === 'signup') {
      return void run(async () => {
        await api.signup(addr, password)
        setInfo(`We emailed a 6-digit code to ${addr}.`)
        setMode('verify')
      })
    }
    return void run(async () => onAuthed(await api.verify(addr, code.trim())))
  }

  async function resend() {
    await run(async () => {
      await api.resend(email.trim())
      setInfo('Code resent — check your inbox.')
    })
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'verify' ? 'Verify your email' : 'Sign in'
  const subtitle =
    mode === 'verify' ? `Enter the code sent to ${email.trim() || 'your email'}.`
    : mode === 'signup' && openRegistration ? 'Anyone can sign up — pick your mailbox after verifying.'
    : undefined

  return (
    <AuthScreen title={title} subtitle={subtitle} brandName={appName} logoUrl={logoUrl}>
      {mode !== 'verify' && (
        <div className="mb-4">
          {oauth && (googleClientId || githubClientId) ? (
            <>
              <div className="space-y-2">
                {googleClientId && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => startGoogle(googleClientId)}
                    className="w-full justify-center gap-2 border border-[var(--color-border)]"
                  >
                    <ProviderIcon id="google" className="size-4" />
                    Continue with Google
                  </Button>
                )}
                {githubClientId && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => startGitHub(githubClientId)}
                    className="w-full justify-center gap-2 border border-[var(--color-border)]"
                  >
                    <ProviderIcon id="github" className="size-4" />
                    Continue with GitHub
                  </Button>
                )}
              </div>
              <div className="my-3 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                <span className="h-px flex-1 bg-[var(--color-border)]" /> or <span className="h-px flex-1 bg-[var(--color-border)]" />
              </div>
            </>
          ) : (
            <p className="mb-1 text-xs text-[var(--color-muted)]">
              Social sign-in isn’t set up — an admin can enable it in Settings.
            </p>
          )}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {mode !== 'verify' && (
          <>
            <Field
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {mode === 'verify' && (
          <Field
            label="6-digit code"
            inputMode="numeric"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        )}

        {info && <p className="text-sm text-[var(--color-muted)]">{info}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy
            ? 'Working…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'verify'
                ? 'Verify & continue'
                : 'Sign in'}
        </Button>
      </form>

      <div className="mt-4 text-center text-sm text-[var(--color-muted)] space-x-3">
        {mode === 'login' && (
          <button onClick={() => { setMode('signup'); setError(null); setInfo(null) }} className="hover:text-[var(--color-text)]">
            Need an account? Sign up
          </button>
        )}
        {mode === 'signup' && (
          <button onClick={() => { setMode('login'); setError(null); setInfo(null) }} className="hover:text-[var(--color-text)]">
            Have an account? Sign in
          </button>
        )}
        {mode === 'verify' && (
          <>
            <button onClick={resend} disabled={busy} className="hover:text-[var(--color-text)]">
              Resend code
            </button>
            <button onClick={() => { setMode('login'); setError(null); setInfo(null) }} className="hover:text-[var(--color-text)]">
              Back
            </button>
          </>
        )}
      </div>
    </AuthScreen>
  )
}
