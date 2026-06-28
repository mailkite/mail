import { PenSquare } from 'lucide-react'
import type { Folder } from '@mailkite/core'

/**
 * Unified Light · Column 1 — Flow boxes + Views.
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
}: {
  folder: Folder
  onFolder: (f: Folder) => void
  inboxCount?: number
  canCompose?: boolean
  onCompose?: () => void
}) {
  const boxes: { id: Folder; label: string; icon: string; count?: number }[] = [
    { id: 'inbox', label: 'Priority', icon: '📥', count: inboxCount },
    { id: 'starred', label: 'Starred', icon: '⭐' },
    { id: 'archive', label: 'Archive', icon: '🗄' },
  ]

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white p-3">
      {canCompose && (
        <button
          onClick={onCompose}
          className="mb-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          <PenSquare size={15} /> Compose
        </button>
      )}

      {/* Screener — wired in a later phase */}
      <div className="mb-3 rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Screener</div>
          <Soon />
        </div>
        <div className="mt-0.5 text-[12px] text-slate-600">Hold unknown senders for review</div>
      </div>

      {/* Flow boxes */}
      <div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Flow</div>
      <nav className="mt-1.5 space-y-0.5 text-[13px]">
        {boxes.map((b) => {
          const active = folder === b.id
          return (
            <button
              key={b.id}
              onClick={() => onFolder(b.id)}
              className={
                'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition ' +
                (active
                  ? 'bg-indigo-50 font-medium text-indigo-700 ring-1 ring-indigo-100'
                  : 'text-slate-500 hover:bg-slate-50')
              }
            >
              <span>{b.icon} {b.label}</span>
              {b.count ? (
                <span
                  className={
                    'rounded-full px-1.5 text-[11px] font-bold ' +
                    (active ? 'bg-amber-400 text-amber-950' : 'text-slate-400')
                  }
                >
                  {b.count}
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      {/* Bundles — soon */}
      <div className="mt-3 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bundles</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-slate-400">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>✉️ Newsletters</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>🔔 Notifications</span></div>
      </nav>

      <div className="my-3 border-t border-slate-200" />

      {/* Views — soon */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Views</span>
        <Soon />
      </div>
      <nav className="mt-1.5 space-y-0.5 text-[13px] text-slate-400">
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⚡ Action required</span></div>
        <div className="flex cursor-default items-center justify-between rounded-lg px-2.5 py-1.5"><span>⏳ Awaiting reply</span></div>
      </nav>

      <div className="mt-auto pt-3">
        <div className="cursor-default rounded-xl bg-gradient-to-br from-indigo-50 to-violet-50 p-2.5 ring-1 ring-indigo-100">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-medium text-indigo-700">✦ Organize my inbox</div>
            <Soon />
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">AI bulk-triage, with review</div>
        </div>
      </div>
    </div>
  )
}

function Soon() {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">
      soon
    </span>
  )
}
