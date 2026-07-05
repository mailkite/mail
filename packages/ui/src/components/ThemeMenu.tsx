import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '../theme/ThemeProvider'
import { PRESETS, type ThemeMode } from '../theme/presets'

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
]

/**
 * Header theme control: the light/dark icon button opens a popover to pick a
 * color theme (preset) and the light/dark/auto mode. Closes on outside-click
 * or Escape. All state flows through ThemeProvider (persisted, applied live).
 */
export function ThemeMenu() {
  const { mode, resolved, setMode, preset, setPreset } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Show the icon for the current state — Auto surfaces the monitor glyph.
  const Icon = mode === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] ' +
          (open ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
        }
      >
        <Icon size={16} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-2 shadow-lg"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Theme
          </p>
          <div className="space-y-0.5">
            {PRESETS.map((t) => {
              const active = t.id === preset
              return (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setPreset(t.id)}
                  className={
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition ' +
                    (active
                      ? 'bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] text-[var(--color-text)]'
                      : 'text-[var(--color-muted)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-text)]')
                  }
                >
                  <span
                    className="flex h-5 w-8 shrink-0 items-center gap-0.5 rounded ring-1 ring-black/5"
                    style={{ background: t.swatch.bg }}
                  >
                    <span className="ml-1 h-2.5 w-2.5 rounded-full" style={{ background: t.swatch.accent }} />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.swatch.accent2 }} />
                  </span>
                  <span className="flex-1 truncate font-medium">{t.name}</span>
                  {active && <Check size={14} className="shrink-0 text-[var(--color-accent)]" />}
                </button>
              )
            })}
          </div>

          <div className="my-2 h-px bg-[var(--color-border)]" />

          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Mode
          </p>
          <div className="flex gap-1 px-1 pb-1">
            {MODES.map(({ id, label, icon: MIcon }) => {
              const active = id === mode
              return (
                <button
                  key={id}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setMode(id)}
                  className={
                    'flex flex-1 flex-col items-center gap-1 rounded-lg border px-1 py-1.5 text-[11px] transition ' +
                    (active
                      ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] text-[var(--color-text)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-text)]')
                  }
                >
                  <MIcon size={15} /> {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
