import { useCallback, useEffect, useState } from 'react'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { MailApp } from './MailApp'
import { Auth } from './Auth'
import { ClaimMailbox } from './ClaimMailbox'

function Splash({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-muted)]">
      {error ? (
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          {onRetry && (
            <button onClick={onRetry} className="text-sm text-[var(--color-accent)] hover:underline">
              Retry
            </button>
          )}
        </div>
      ) : (
        <span className="text-sm">Loading…</span>
      )}
    </div>
  )
}

/**
 * Root gate: resolve the session + capabilities once, then route to the right
 * screen — first-run setup → login → mail. After a login/setup we confirm the
 * session actually stuck (api.me) so a dropped cookie surfaces as a clear error
 * instead of silently bouncing back to the login form.
 */
const FALLBACK_CONFIG: AppConfig = {
  sending: false, push: false, needsSetup: false, oauth: false, googleClientId: '', githubClientId: '',
  appName: 'MailKite Mail', logoUrl: '', openRegistration: false,
}
const GOOGLE_CALLBACK = '/auth/google/callback'
const GITHUB_CALLBACK = '/auth/github/callback'

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [claimNeeded, setClaimNeeded] = useState<boolean | null>(false)

  // Run after a successful login/signup/oauth: confirm the session cookie is honored.
  const confirmSession = useCallback(async (fallback: SessionUser) => {
    const me = await api.me().catch(() => null)
    if (!me) {
      throw new Error(
        'Signed in, but the session was not recognized on the next request. ' +
          'Make sure third-party/all cookies are enabled for this site, then try again.',
      )
    }
    setUser(me ?? fallback)
    api.config().then(setConfig).catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      // Returning from an OAuth provider: exchange the code, then clean the URL.
      const url = new URL(window.location.href)
      const oauthCallback =
        url.pathname === GOOGLE_CALLBACK ? { path: GOOGLE_CALLBACK, exchange: api.loginWithGoogle }
        : url.pathname === GITHUB_CALLBACK ? { path: GITHUB_CALLBACK, exchange: api.loginWithGitHub }
        : null
      if (oauthCallback && url.searchParams.get('code')) {
        const code = url.searchParams.get('code') as string
        const redirectUri = `${url.origin}${oauthCallback.path}`
        const u = await oauthCallback.exchange(code, redirectUri)
        window.history.replaceState(null, '', '/')
        setConfig(await api.config().catch(() => FALLBACK_CONFIG))
        await confirmSession(u)
        return
      }
      const [cfg, me] = await Promise.all([api.config(), api.me()])
      setConfig(cfg)
      setUser(me)
    } catch (e) {
      setConfig((c) => c ?? FALLBACK_CONFIG)
      setLoadError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setReady(true)
    }
  }, [confirmSession])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Reflect the configured app name in the tab title.
  useEffect(() => {
    if (config?.appName) document.title = config.appName
  }, [config?.appName])

  // A signed-in non-admin with open registration may need to claim a mailbox.
  useEffect(() => {
    if (!user) { setClaimNeeded(false); return }
    if (user.role === 'admin') { setClaimNeeded(false); return }
    setClaimNeeded(null)
    api.registrationStatus().then((s) => setClaimNeeded(s.canClaim)).catch(() => setClaimNeeded(false))
  }, [user])

  if (!ready || !config) return <Splash error={loadError} onRetry={refresh} />

  // No users yet → first signup (that user becomes admin); otherwise sign in.
  if (!user) {
    return (
      <Auth
        // First run, or open registration on → land on Sign up by default.
        initialMode={config.needsSetup || config.openRegistration ? 'signup' : 'login'}
        oauth={config.oauth}
        googleClientId={config.googleClientId}
        githubClientId={config.githubClientId}
        appName={config.appName}
        logoUrl={config.logoUrl}
        openRegistration={config.openRegistration}
        onAuthed={confirmSession}
      />
    )
  }

  // A self-registered user with no mailbox yet (open registration) claims one.
  if (claimNeeded === null) return <Splash />
  if (claimNeeded) {
    return (
      <ClaimMailbox
        appName={config.appName}
        logoUrl={config.logoUrl}
        onClaimed={async () => { setClaimNeeded(false); await refresh() }}
      />
    )
  }

  return (
    <MailApp
      user={user}
      onLogout={async () => {
        await api.logout().catch(() => {})
        setUser(null)
        void refresh()
      }}
    />
  )
}
