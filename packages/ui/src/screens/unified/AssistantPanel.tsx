import { useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { senderName, snippet } from './util'

/**
 * Unified Light · Column 3 — the Assistant.
 * The AI endpoints (summary / smart-replies / to-dos / chat) arrive in a later
 * phase; for now the panel shows a real message preview and lets a smart-reply
 * chip prefill the composer. Cards are tagged "soon" where they await a provider.
 * Collapses to an icon rail (mirroring the LeftRail) via `collapsed`/`onToggle`.
 */
export function AssistantPanel({
  message,
  canSend,
  onSmartReply,
  collapsed,
  onToggle,
}: {
  message: MessageRow | null
  canSend?: boolean
  onSmartReply?: (text: string) => void
  collapsed?: boolean
  onToggle?: () => void
}) {
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 bg-gradient-to-b from-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] to-[var(--color-panel)] p-2">
        <button
          onClick={onToggle}
          aria-label="Expand assistant"
          title="Expand assistant"
          className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]"
        >
          <PanelRightOpen size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-[var(--color-border)]" />
        <button
          onClick={onToggle}
          aria-label="Assistant"
          title="Assistant"
          className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-[14px] text-white shadow-sm transition hover:brightness-110"
        >
          ✦
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] to-[var(--color-panel)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-[12px] text-white">✦</div>
        <span className="text-[13px] font-semibold text-[var(--color-text)]">Assistant</span>
        <span className="rounded-md bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">on-device</span>
        {onToggle && (
          <button
            onClick={onToggle}
            aria-label="Collapse assistant"
            title="Collapse assistant"
            className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-muted)]"
          >
            <PanelRightClose size={15} />
          </button>
        )}
      </div>

      {!message ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-[12.5px] text-[var(--color-muted)]">
          Open a message and the assistant will summarize it, draft replies, and pull out to-dos.
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Card label="Preview" labelTone="indigo">
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              <b className="text-[var(--color-text)]">{senderName(message.from_addr)}</b> — {snippet(message, 220) || '(no preview)'}
            </p>
          </Card>

          <Card label="✦ Smart replies" soon>
            <div className="mt-2 space-y-1.5">
              {['👍 Sounds good — thanks!', 'Got it, I’ll take a look.', 'Can we find time to discuss?'].map((r) => (
                <button
                  key={r}
                  disabled={!canSend}
                  onClick={() => onSmartReply?.(r.replace(/^[^A-Za-z]+/, ''))}
                  className="block w-full truncate rounded-lg bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-2.5 py-1.5 text-left text-[12px] text-[var(--color-text)] ring-1 ring-[var(--color-border)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] disabled:opacity-50"
                >
                  {r}
                </button>
              ))}
            </div>
          </Card>

          <Card label="✦ Extracted to-dos" soon>
            <Todos />
          </Card>
        </div>
      )}

      <div className="shrink-0 border-t border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2 rounded-xl bg-[var(--color-panel)] px-3 py-2 text-[12.5px] text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
          Ask or instruct… <span className="ml-auto text-[var(--color-muted)]">↵</span>
        </div>
      </div>
    </div>
  )
}

function Card({
  label,
  labelTone,
  soon,
  children,
}: {
  label: string
  labelTone?: 'indigo'
  soon?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-[var(--color-panel)] p-3 shadow-sm ring-1 ring-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <span className={'text-[11px] font-semibold uppercase tracking-wide ' + (labelTone === 'indigo' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]')}>
          {label}
        </span>
        {soon && (
          <span className="rounded bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
            soon
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Todos() {
  const [done, setDone] = useState<Record<number, boolean>>({})
  const items = ['Reply with availability', 'Review the attached doc']
  return (
    <div className="mt-2 space-y-1.5">
      {items.map((t, i) => (
        <label key={i} className="flex items-start gap-2 text-[12.5px] text-[var(--color-muted)]">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={!!done[i]} onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))} />
          <span className={done[i] ? 'line-through text-[var(--color-muted)]' : ''}>{t}</span>
        </label>
      ))}
    </div>
  )
}
