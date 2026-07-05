import { PenSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Folder } from '@mailkite/core'
import { Kbd } from './Kbd'

const BOXES: { id: Folder; label: string; icon: string; desc: string; key: string }[] = [
  { id: 'inbox', label: 'Priority', icon: '📥', desc: 'Mail from real people that needs you', key: '1' },
  { id: 'starred', label: 'Starred', icon: '⭐', desc: 'Messages you’ve flagged', key: '2' },
  { id: 'archive', label: 'Archive', icon: '🗄', desc: 'Everything you’ve filed away', key: '3' },
]

/** Hover tooltip for collapsed icons — title + description, escapes the rail to
 *  the right. Pure CSS (group-hover); no portal needed since the strip doesn't clip. */
function Tip({ label, desc, kbd, children }: { label: string; desc?: string; kbd?: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative">
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden w-52 -translate-y-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-left shadow-lg group-hover/tip:block dark:bg-slate-700"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-white">{label}</span>
          {kbd && <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-slate-200">{kbd}</kbd>}
        </div>
        {desc && <div className="mt-0.5 text-[11px] leading-snug text-slate-300">{desc}</div>}
      </div>
    </div>
  )
}

/**
 * Unified Light · Column 1 — Flow boxes + Views, collapsible to an icon strip.
 * Boxes that map to real folders (Priority/Starred/Archive) are interactive;
 * the AI-era groups (Screener, Bundles, smart Views, Organize) are rendered to
 * the spec but marked "soon" — they light up in later phases (see
 * docs/ui-redesign-plan.md).
 */
export function LeftRail({
  folder,
  onFolder,
  inboxCount,
  canCompose,
  onCompose,
  collapsed,
  onToggle,
}: {
  folder: Folder
  onFolder: (f: Folder) => void
  inboxCount?: number
  canCompose?: boolean
  onCompose?: () => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 overflow-visible bg-[var(--color-panel)] p-2">
        <Tip label="Expand menu">
          <button onClick={onToggle} aria-label="Expand menu" className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]">
            <PanelLeftOpen size={16} />
          </button>
        </Tip>
        {canCompose && (
          <Tip label="Compose" desc="Write a new message">
            <button onClick={onCompose} aria-label="Compose" className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-accent)] text-white shadow-sm transition hover:opacity-90">
              <PenSquare size={15} />
            </button>
          </Tip>
        )}
        <div className="my-1 h-px w-6 bg-[var(--color-border)]" />
        {BOXES.map((b) => {
          const active = folder === b.id
          return (
            <Tip key={b.id} label={b.label} desc={b.desc} kbd={b.key}>
              <button
                onClick={() => onFolder(b.id)}
                aria-label={b.label}
                className={
                  'relative grid h-9 w-9 place-items-center rounded-lg text-[15px] transition ' +
                  (active
                    ? 'bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] ring-1 ring-[var(--color-accent)]'
                    : 'hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]')
                }
              >
                <span>{b.icon}</span>
                {b.id === 'inbox' && inboxCount ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-amber-950">{inboxCount}</span>
                ) : null}
              </button>
            </Tip>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[var(--color-panel)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Menu</span>
        <button onClick={onToggle} aria-label="Collapse menu" title="Collapse menu" className="grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-text)]">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {canCompose && (
        <button
          onClick={onCompose}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <PenSquare size={15} /> Compose
        </button>
      )}

      {/* Screener — wired in a later phase */}
      <div className="mb-3 rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:ring-amber-400/20">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Screener</div>
          <Soon />
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">Hold unknown senders for review</div>
      </div>

      {/* Flow boxes */}
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Flow</div>
      <nav className="mt-1.5 space-y-0.5 text-[13px]">
        {BOXES.map((b) => {
          const active = folder === b.id
          return (
            <button
              key={b.id}
              onClick={() => onFolder(b.id)}
              className={
                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition ' +
                (active
                  ? 'bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] font-medium text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
                  : 'text-[var(--color-muted)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]')
              }
            >
              <span>{b.icon} {b.label}</span>
              <span className="flex items-center gap-1.5">
                {b.id === 'inbox' && inboxCount ? (
                  <span className={'rounded-full px-1.5 text-[11px] font-bold ' + (active ? 'bg-amber-400 text-amber-950' : 'text-[var(--color-muted)]')}>{inboxCount}</span>
                ) : null}
                <Kbd>{b.key}</Kbd>
              </span>
            </button>
          )
        })}
      </nav>

      {/* Bundles — soon */}
      <div className="mt-3 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Bundles</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-[var(--color-muted)]">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>✉️ Newsletters</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>🔔 Notifications</span></div>
      </nav>

      <div className="my-3 border-t border-[var(--color-border)]" />

      {/* Views — soon */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">Views</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-[var(--color-muted)]">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⚡ Action required</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⏳ Awaiting reply</span></div>
      </nav>

      <div className="mt-auto pt-3">
        <div className="cursor-default rounded-xl bg-gradient-to-br from-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] to-[color-mix(in_oklab,var(--color-accent-2)_10%,transparent)] p-2.5 ring-1 ring-[var(--color-accent)]">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-[var(--color-accent)]">✦ Organize my inbox</div>
            <Soon />
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">AI bulk-triage, with review</div>
        </div>
      </div>
    </div>
  )
}

function Soon() {
  return (
    <span className="rounded bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
      soon
    </span>
  )
}
