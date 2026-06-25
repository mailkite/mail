import type { ReactNode } from 'react'
import { Inbox, Moon, Sun, Archive, Star, PenSquare, Search, Settings as SettingsIcon } from 'lucide-react'
import type { Folder } from '@mailkite/core'
import type { SessionUser } from '../lib/api'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../components/Button'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'

/** "bucabay@gmail.com" → "bucabay"; prefers a real name when we have one. */
function displayName(user: SessionUser): string {
  return user.name?.trim() || user.email.split('@')[0]
}

const FOLDERS: { id: Folder; icon: typeof Inbox; label: string }[] = [
  { id: 'inbox', icon: Inbox, label: 'Inbox' },
  { id: 'starred', icon: Star, label: 'Starred' },
  { id: 'archive', icon: Archive, label: 'Archive' },
]

export function AppShell({
  children,
  folder,
  onFolder,
  query,
  onSearch,
  canCompose,
  onCompose,
  user,
  onProfile,
  profileActive,
  onSettings,
  settingsActive,
  appName,
  logoUrl,
}: {
  children: ReactNode
  folder: Folder
  onFolder: (f: Folder) => void
  query: string
  onSearch: (q: string) => void
  canCompose?: boolean
  onCompose?: () => void
  user?: SessionUser
  onProfile?: () => void
  profileActive?: boolean
  onSettings?: () => void
  settingsActive?: boolean
  appName?: string
  logoUrl?: string
}) {
  const { resolved, setMode } = useTheme()
  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 h-14 shrink-0">
        <Logo name={appName} logoUrl={logoUrl} className="shrink-0" />
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" />
          <input
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search mail"
            className="w-full rounded-md border border-[var(--color-border)] bg-transparent pl-7 pr-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div className="flex-1" />
        <Button variant="ghost" aria-label="Toggle theme" onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}>
          {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        {user && onProfile && (
          <button
            onClick={onProfile}
            title="Account settings"
            aria-label="Account settings"
            className={
              'flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm transition ' +
              (profileActive
                ? 'text-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]')
            }
          >
            <Avatar email={user.email} src={user.avatarUrl} size={28} />
            <span className="hidden sm:block max-w-[10rem] truncate font-medium">{displayName(user)}</span>
          </button>
        )}
      </header>
      <div className="flex flex-1 min-h-0">
        <nav className="w-48 shrink-0 border-r border-[var(--color-border)] p-2 space-y-0.5">
          {canCompose && (
            <Button className="mb-2 w-full justify-center" onClick={onCompose}>
              <PenSquare size={16} /> Compose
            </Button>
          )}
          {FOLDERS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => onFolder(id)}
              className={
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm ' +
                (folder === id && !settingsActive && !profileActive
                  ? 'text-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
              }
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
          {onSettings && (
            <button
              onClick={onSettings}
              className={
                'mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm ' +
                (settingsActive
                  ? 'text-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
              }
            >
              <SettingsIcon size={16} />
              Settings
            </button>
          )}
        </nav>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
