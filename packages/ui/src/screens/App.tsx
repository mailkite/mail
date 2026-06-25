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
export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const [cfg, me] = await Promise.all([api.config(), api.me()])
      setConfig(cfg)
      setUser(me)
    } catch (e) {
      setConfig((c) => c ?? { sending: false, push: false, needsSetup: false })
      setLoadError(e instanceof Error ? e.message : 'Could not reach the server.')
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Run after a successful login/setup: confirm the session cookie is honored.
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

  if (!ready || !config) return <Splash error={loadError} onRetry={refresh} />

  // No users yet → first signup (that user becomes admin); otherwise sign in.
  if (!user) {
    return <Auth initialMode={config.needsSetup ? 'signup' : 'login'} onAuthed={confirmSession} />
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
