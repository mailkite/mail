import type { ReactNode } from 'react'
import { Inbox, Moon, Sun, Send, Archive, Star } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from '../components/Button'

const NAV = [
  { icon: Inbox, label: 'Inbox', active: true },
  { icon: Star, label: 'Starred' },
  { icon: Send, label: 'Sent' },
  { icon: Archive, label: 'Archive' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const { resolved, setMode } = useTheme()
  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 h-14 shrink-0">
        <div className="flex items-center gap-2 font-semibold">
          <span className="text-gradient text-lg">MailKite Mail</span>
        </div>
        <Button
          variant="ghost"
          aria-label="Toggle theme"
          onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
        >
          {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </header>
      <div className="flex flex-1 min-h-0">
        <nav className="w-48 shrink-0 border-r border-[var(--color-border)] p-2 space-y-0.5">
          {NAV.map(({ icon: Icon, label, active }) => (
            <button
              key={label}
              className={
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm ' +
                (active
                  ? 'text-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
              }
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
