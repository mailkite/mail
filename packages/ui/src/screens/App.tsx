import { useCallback, useEffect, useState } from 'react'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { MailApp } from './MailApp'
import { Auth } from './Auth'

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
  sending: false, push: false, needsSetup: false, oauth: false, googleClientId: '',
  appName: 'MailKite Mail', logoUrl: '',
}
const GOOGLE_CALLBACK = '/auth/google/callback'

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

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
      // Returning from Google: exchange the code, then clean the URL.
      const url = new URL(window.location.href)
      if (url.pathname === GOOGLE_CALLBACK && url.searchParams.get('code')) {
        const code = url.searchParams.get('code') as string
        const redirectUri = `${url.origin}${GOOGLE_CALLBACK}`
        const u = await api.loginWithGoogle(code, redirectUri)
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

  if (!ready || !config) return <Splash error={loadError} onRetry={refresh} />

  // No users yet → first signup (that user becomes admin); otherwise sign in.
  if (!user) {
    return (
      <Auth
        initialMode={config.needsSetup ? 'signup' : 'login'}
        oauth={config.oauth}
        googleClientId={config.googleClientId}
        appName={config.appName}
        logoUrl={config.logoUrl}
        onAuthed={confirmSession}
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
