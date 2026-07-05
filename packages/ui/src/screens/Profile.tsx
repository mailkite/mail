import { useState } from 'react'
import { AlertTriangle, Check, LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { api, type SessionUser } from '../lib/api'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { useTheme } from '../theme/ThemeProvider'
import { PRESETS, type ThemeMode } from '../theme/presets'

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
]

/**
 * Appearance — per-user color theme (preset) and light/dark/auto mode. Persists
 * via ThemeProvider (localStorage); applies live to the whole app.
 */
function AppearanceSection() {
  const { mode, setMode, preset, setPreset } = useTheme()
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold">Appearance</h2>
      <p className="mt-0.5 text-xs text-[var(--color-muted)]">
        Pick a color theme and how it follows your system.
      </p>

      {/* Theme presets */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {PRESETS.map((t) => {
          const active = t.id === preset
          return (
            <button
              key={t.id}
              onClick={() => setPreset(t.id)}
              aria-pressed={active}
              className={
                'relative flex flex-col gap-2 rounded-lg border p-3 text-left transition ' +
                (active
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/50')
              }
            >
              {active && (
                <span className="absolute right-2 top-2 grid h-4 w-4 place-items-center rounded-full bg-[var(--color-accent)] text-white">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
              {/* Mini preview swatch */}
              <span
                className="flex h-9 items-center gap-1.5 rounded-md px-2 ring-1 ring-black/5"
                style={{ background: t.swatch.bg }}
              >
                <span className="h-4 w-4 rounded-full" style={{ background: t.swatch.accent }} />
                <span className="h-4 w-4 rounded-full" style={{ background: t.swatch.accent2 }} />
                <span
                  className="ml-auto h-5 w-8 rounded"
                  style={{ background: t.swatch.panel, boxShadow: '0 1px 2px rgba(0,0,0,.12)' }}
                />
              </span>
              <span>
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--color-muted)]">
                  {t.description}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Light / Dark / Auto */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs text-[var(--color-muted)]">Mode</p>
        <div className="inline-flex rounded-lg border border-[var(--color-border)] p-0.5">
          {MODES.map(({ id, label, icon: Icon }) => {
            const active = id === mode
            return (
              <button
                key={id}
                onClick={() => setMode(id)}
                aria-pressed={active}
                className={
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ' +
                  (active
                    ? 'bg-[var(--color-accent)] font-medium text-white'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
                }
              >
                <Icon size={14} /> {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Account settings for the signed-in user: identity card, sign out, and a
 * danger zone to permanently delete the account (type-to-confirm).
 */
export function Profile({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const name = user.name?.trim() || user.email.split('@')[0]
  const isAdmin = user.role === 'admin'

  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canDelete = typed.trim().toLowerCase() === user.email.toLowerCase() && !busy

  async function deleteAccount() {
    if (!canDelete) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount()
      // Session cookie is gone server-side — drop back to the sign-in screen.
      onLogout()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete account')
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-semibold">Account</h1>

        {/* Identity */}
        <div className="rounded-lg border border-[var(--color-border)] p-5">
          <div className="flex items-center gap-4">
            <Avatar email={user.email} src={user.avatarUrl} size={56} className="text-xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-lg font-semibold">{name}</p>
                {isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-accent)]/40 bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]">
                    <ShieldCheck size={12} /> Admin
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-[var(--color-muted)]">{user.email}</p>
            </div>
          </div>

          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <Button variant="ghost" onClick={onLogout}>
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        </div>

        {/* Appearance */}
        <AppearanceSection />

        {/* Danger zone */}
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-red-400">Delete account</h2>
              <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                Permanently removes your account and ends your session. This takes effect immediately
                and can&apos;t be undone.
              </p>

              <div className="mt-3 space-y-1.5">
                <label htmlFor="confirm-email" className="text-xs text-[var(--color-muted)]">
                  Type <span className="font-mono font-medium text-[var(--color-text)]">{user.email}</span> to confirm
                </label>
                <input
                  id="confirm-email"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={user.email}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canDelete) void deleteAccount()
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-red-400"
                />
              </div>

              {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

              <button
                onClick={() => void deleteAccount()}
                disabled={!canDelete}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-500/90 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
