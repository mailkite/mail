import type { MessageRow } from '@mailkite/core'
import { cn } from '../lib/cn'

interface Props {
  messages: MessageRow[]
  selectedId: string | null
  loading: boolean
  error: string | null
  onSelect: (m: MessageRow) => void
}

function preview(m: MessageRow): string {
  return (m.text_body ?? m.html_body ?? '').replace(/<[^>]+>/g, ' ').slice(0, 120)
}

export function InboxList({ messages, selectedId, loading, error, onSelect }: Props) {
  return (
    <div className="border-r border-[var(--color-border)] overflow-y-auto h-full">
      {loading && <p className="p-4 text-sm text-[var(--color-muted)]">Loading…</p>}
      {error && <p className="p-4 text-sm text-red-400">{error}</p>}
      {!loading && !error && messages.length === 0 && (
        <p className="p-4 text-sm text-[var(--color-muted)]">No mail yet.</p>
      )}
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => onSelect(m)}
              className={cn(
                'w-full text-left px-4 py-3 border-b border-[var(--color-border)] transition',
                selectedId === m.id
                  ? 'bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]'
                  : 'hover:bg-[color-mix(in_oklab,var(--color-border)_30%,transparent)]',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn('truncate text-sm', m.unread ? 'font-semibold text-[var(--color-text)]' : 'text-[var(--color-muted)]')}>
                  {m.from_addr}
                </span>
                {m.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]" /> : null}
              </div>
              <div className="truncate text-sm text-[var(--color-text)]">{m.subject ?? '(no subject)'}</div>
              <div className="truncate text-xs text-[var(--color-muted)]">{preview(m)}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
