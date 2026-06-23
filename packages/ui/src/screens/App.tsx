import { useCallback, useEffect, useState } from 'react'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { MailApp } from './MailApp'
import { Login } from './Login'
import { SetupWizard } from './SetupWizard'

function Splash() {
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-muted)]">
      <span className="text-sm">Loading…</span>
    </div>
  )
}

/**
 * Root gate: resolve the session + capabilities once, then route to the right
 * screen — first-run setup → login → mail.
 */
export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    const [cfg, me] = await Promise.all([
      api.config().catch(() => ({ sending: false, push: false, needsSetup: false }) as AppConfig),
      api.me().catch(() => null),
    ])
    setConfig(cfg)
    setUser(me)
    setReady(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!ready || !config) return <Splash />

  if (config.needsSetup && !user) {
    return (
      <SetupWizard
        onCreate={async (email, password) => {
          await api.setup(email, password)
          await refresh()
        }}
      />
    )
  }

  if (!user) {
    return (
      <Login
        onLogin={async (email, password) => {
          await api.login(email, password)
          await refresh()
        }}
      />
    )
  }

  return (
    <MailApp
      user={user}
      onLogout={async () => {
        await api.logout()
        await refresh()
      }}
    />
  )
}
