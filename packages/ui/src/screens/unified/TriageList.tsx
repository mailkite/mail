import { Star } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { Avatar } from '../../components/Avatar'
import { Kbd } from './Kbd'
import { senderName, fmtTime, snippet } from './util'

/** Unified Light · Column 2 — the triage card list. */
export function TriageList({
  messages,
  loading,
  error,
  cursor,
  selectedId,
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
  selectedId?: string | null
  title: string
  subtitle: string
  onOpen: (m: MessageRow) => void
  onStar: (m: MessageRow) => void
  onLater: (m: MessageRow) => void
  onAside: (m: MessageRow) => void
}) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-panel)_60%,transparent)] px-5 py-2.5">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--color-text)]">{title}</h3>
          <p className="text-[11px] text-[var(--color-muted)]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
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
              active={selectedId ? selectedId === m.id : i === cursor}
              onOpen={() => onOpen(m)}
              onStar={() => onStar(m)}
              onLater={() => onLater(m)}
              onAside={() => onAside(m)}
            />
          ))
        )}
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
        'group cursor-pointer rounded-xl bg-[var(--color-panel)] p-3 transition hover:shadow-sm ' +
        (active
          ? 'border-l-2 border-[var(--color-accent)] shadow-sm ring-1 ring-[var(--color-border)]'
          : 'ring-1 ring-[var(--color-border)]')
      }
    >
      <div className="flex items-center gap-3">
        <Avatar email={m.from_addr} size={36} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={'text-[14px] text-[var(--color-text)] ' + (unread ? 'font-semibold' : 'font-medium')}>
              {senderName(m.from_addr)}
            </span>
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />}
            <span className="ml-auto shrink-0 text-[11px] text-[var(--color-muted)]">{fmtTime(m.received_at)}</span>
          </div>
          <div className={'truncate text-[13px] ' + (unread ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]')}>
            {m.subject || '(no subject)'}
          </div>
          <div className="truncate text-[12px] text-[var(--color-muted)]">{snippet(m)}</div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
          <Quick label="↩ Later" onClick={onLater} tone="amber" />
          <Quick label="📎 Aside" onClick={onAside} />
          <button
            onClick={(e) => { e.stopPropagation(); onStar() }}
            aria-label="Star"
            className="grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]"
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
      : 'bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] text-[var(--color-text)] ring-1 ring-[var(--color-border)] hover:bg-[color-mix(in_oklab,var(--color-border)_55%,transparent)]'
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={'rounded-lg px-2 py-1.5 text-[12px] font-medium transition ' + cls}
    >
      {label}
    </button>
  )
}

function Placeholder({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div className={'grid place-items-center py-16 text-[13px] ' + (tone === 'error' ? 'text-rose-500' : 'text-[var(--color-muted)]')}>
      {text}
    </div>
  )
}
