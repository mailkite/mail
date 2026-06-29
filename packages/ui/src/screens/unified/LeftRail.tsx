import { PenSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Folder } from '@mailkite/core'

const BOXES: { id: Folder; label: string; icon: string; desc: string }[] = [
  { id: 'inbox', label: 'Priority', icon: '📥', desc: 'Mail from real people that needs you' },
  { id: 'starred', label: 'Starred', icon: '⭐', desc: 'Messages you’ve flagged' },
  { id: 'archive', label: 'Archive', icon: '🗄', desc: 'Everything you’ve filed away' },
]

/** Hover tooltip for collapsed icons — title + description, escapes the rail to
 *  the right. Pure CSS (group-hover); no portal needed since the strip doesn't clip. */
function Tip({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="group/tip relative">
      {children}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden w-52 -translate-y-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-left shadow-lg group-hover/tip:block dark:bg-slate-700"
      >
        <div className="text-[12px] font-medium text-white">{label}</div>
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
      <div className="flex h-full flex-col items-center gap-1 overflow-visible bg-white p-2 dark:bg-slate-900">
        <Tip label="Expand menu">
          <button onClick={onToggle} aria-label="Expand menu" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            <PanelLeftOpen size={16} />
          </button>
        </Tip>
        {canCompose && (
          <Tip label="Compose" desc="Write a new message">
            <button onClick={onCompose} aria-label="Compose" className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-500">
              <PenSquare size={15} />
            </button>
          </Tip>
        )}
        <div className="my-1 h-px w-6 bg-slate-200 dark:bg-slate-800" />
        {BOXES.map((b) => {
          const active = folder === b.id
          return (
            <Tip key={b.id} label={b.label} desc={b.desc}>
              <button
                onClick={() => onFolder(b.id)}
                aria-label={b.label}
                className={
                  'relative grid h-9 w-9 place-items-center rounded-lg text-[15px] transition ' +
                  (active
                    ? 'bg-indigo-50 ring-1 ring-indigo-100 dark:bg-indigo-500/15 dark:ring-indigo-500/30'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800')
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
    <div className="flex h-full flex-col overflow-y-auto bg-white p-3 dark:bg-slate-900">
      <div className="mb-1 flex items-center justify-between">
        <span className="pl-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Menu</span>
        <button onClick={onToggle} aria-label="Collapse menu" title="Collapse menu" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {canCompose && (
        <button
          onClick={onCompose}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-500"
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
        <div className="mt-0.5 text-[12px] text-slate-600 dark:text-slate-400">Hold unknown senders for review</div>
      </div>

      {/* Flow boxes */}
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Flow</div>
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
                  ? 'bg-indigo-50 font-medium text-indigo-700 ring-1 ring-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30'
                  : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800')
              }
            >
              <span>{b.icon} {b.label}</span>
              {b.id === 'inbox' && inboxCount ? (
                <span className={'rounded-full px-1.5 text-[11px] font-bold ' + (active ? 'bg-amber-400 text-amber-950' : 'text-slate-400 dark:text-slate-500')}>{inboxCount}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {/* Bundles — soon */}
      <div className="mt-3 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Bundles</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-slate-400 dark:text-slate-500">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>✉️ Newsletters</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>🔔 Notifications</span></div>
      </nav>

      <div className="my-3 border-t border-slate-200 dark:border-slate-800" />

      {/* Views — soon */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Views</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-slate-400 dark:text-slate-500">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⚡ Action required</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⏳ Awaiting reply</span></div>
      </nav>

      <div className="mt-auto pt-3">
        <div className="cursor-default rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 p-2.5 ring-1 ring-indigo-100 dark:from-indigo-500/10 dark:to-violet-500/10 dark:ring-indigo-500/20">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-indigo-700 dark:text-indigo-300">✦ Organize my inbox</div>
            <Soon />
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">AI bulk-triage, with review</div>
        </div>
      </div>
    </div>
  )
}

function Soon() {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">
      soon
    </span>
  )
}
