import { Star } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { Avatar } from '../../components/Avatar'
import { senderName, fmtTime, snippet } from './util'

/** Unified Light · Column 2 — the triage card list. */
export function TriageList({
  messages,
  loading,
  error,
  cursor,
  title,
  subtitle,
  onOpen,
  onStar,
  onLater,
  onAside,
}: {
  messages: MessageRow[]
  loading: boolean
  error: string | null
  cursor: number
  title: string
  subtitle: string
  onOpen: (m: MessageRow) => void
  onStar: (m: MessageRow) => void
  onLater: (m: MessageRow) => void
  onAside: (m: MessageRow) => void
}) {
  return (
    <div className="flex min-w-0 flex-col bg-[#f7f8fa]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/60 px-5 py-2.5">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Kbd>J</Kbd><Kbd>K</Kbd> move<Kbd className="ml-1">E</Kbd> archive
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-5 py-3.5">
        {loading ? (
          <Placeholder text="Loading…" />
        ) : error ? (
          <Placeholder text={error} tone="error" />
        ) : messages.length === 0 ? (
          <Placeholder text="✦ Inbox zero — nothing here." />
        ) : (
          messages.map((m, i) => (
            <TriageCard
              key={m.id}
              m={m}
              active={i === cursor}
              onOpen={() => onOpen(m)}
              onStar={() => onStar(m)}
              onLater={() => onLater(m)}
              onAside={() => onAside(m)}
            />
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-200 bg-white/60 px-5 py-2.5 text-[11px]">
        <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-700 ring-1 ring-amber-200">↩ Reply Later</span>
        <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-700 ring-1 ring-sky-200">📎 Set Aside</span>
        <span className="ml-auto text-slate-400">
          {messages.length === 0 ? 'Inbox Zero ✦' : <>Inbox Zero in <b className="text-indigo-600">{messages.length}</b></>}
        </span>
      </div>
    </div>
  )
}

function TriageCard({
  m,
  active,
  onOpen,
  onStar,
  onLater,
  onAside,
}: {
  m: MessageRow
  active: boolean
  onOpen: () => void
  onStar: () => void
  onLater: () => void
  onAside: () => void
}) {
  const unread = !!m.unread
  return (
    <div
      onClick={onOpen}
      className={
        'group cursor-pointer rounded-xl bg-white p-3 transition hover:shadow-sm ' +
        (active ? 'border-l-2 border-indigo-500 shadow-sm ring-1 ring-slate-200' : 'ring-1 ring-slate-200')
      }
    >
      <div className="flex items-center gap-3">
        <Avatar email={m.from_addr} size={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={'text-[14px] text-slate-900 ' + (unread ? 'font-semibold' : 'font-medium')}>
              {senderName(m.from_addr)}
            </span>
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />}
            <span className="ml-auto shrink-0 text-[11px] text-slate-400">{fmtTime(m.received_at)}</span>
          </div>
          <div className={'truncate text-[13px] ' + (unread ? 'text-slate-800' : 'text-slate-600')}>
            {m.subject || '(no subject)'}
          </div>
          <div className="truncate text-[12px] text-slate-400">{snippet(m)}</div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
          <Quick label="↩ Later" onClick={onLater} tone="amber" />
          <Quick label="📎 Aside" onClick={onAside} />
          <button
            onClick={(e) => { e.stopPropagation(); onStar() }}
            aria-label="Star"
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <Star size={14} className={m.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Quick({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'amber' }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={'rounded-lg px-2 py-1.5 text-[12px] font-medium transition ' + cls}
    >
      {label}
    </button>
  )
}

function Kbd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <kbd className={'rounded bg-slate-100 px-1.5 py-0.5 ring-1 ring-slate-200 ' + className}>{children}</kbd>
}

function Placeholder({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div className={'grid place-items-center py-16 text-[13px] ' + (tone === 'error' ? 'text-rose-500' : 'text-slate-400')}>
      {text}
    </div>
  )
}
