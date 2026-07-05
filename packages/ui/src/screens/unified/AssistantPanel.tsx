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
      <div className="flex h-full flex-col items-center gap-1 bg-gradient-to-b from-indigo-50/60 to-white p-2 dark:from-indigo-500/10 dark:to-slate-900">
        <button
          onClick={onToggle}
          aria-label="Expand assistant"
          title="Expand assistant"
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <PanelRightOpen size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-slate-200 dark:bg-slate-800" />
        <button
          onClick={onToggle}
          aria-label="Assistant"
          title="Assistant"
          className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-[14px] text-white shadow-sm transition hover:brightness-110"
        >
          ✦
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-indigo-50/60 to-white dark:from-indigo-500/10 dark:to-slate-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-[12px] text-white">✦</div>
        <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Assistant</span>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700">on-device</span>
        {onToggle && (
          <button
            onClick={onToggle}
            aria-label="Collapse assistant"
            title="Collapse assistant"
            className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800"
          >
            <PanelRightClose size={15} />
          </button>
        )}
      </div>

      {!message ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-[12.5px] text-slate-400 dark:text-slate-500">
          Open a message and the assistant will summarize it, draft replies, and pull out to-dos.
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <Card label="Preview" labelTone="indigo">
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-400">
              <b className="text-slate-900 dark:text-slate-100">{senderName(message.from_addr)}</b> — {snippet(message, 220) || '(no preview)'}
            </p>
          </Card>

          <Card label="✦ Smart replies" soon>
            <div className="mt-2 space-y-1.5">
              {['👍 Sounds good — thanks!', 'Got it, I’ll take a look.', 'Can we find time to discuss?'].map((r) => (
                <button
                  key={r}
                  disabled={!canSend}
                  onClick={() => onSmartReply?.(r.replace(/^[^A-Za-z]+/, ''))}
                  className="block w-full truncate rounded-lg bg-slate-50 px-2.5 py-1.5 text-left text-[12px] text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
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

      <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[12.5px] text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">
          Ask or instruct… <span className="ml-auto text-slate-300 dark:text-slate-600">↵</span>
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
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-center justify-between">
        <span className={'text-[11px] font-semibold uppercase tracking-wide ' + (labelTone === 'indigo' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400')}>
          {label}
        </span>
        {soon && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-400 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-500 dark:ring-slate-700">
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
        <label key={i} className="flex items-start gap-2 text-[12.5px] text-slate-600 dark:text-slate-400">
          <input type="checkbox" className="mt-0.5 accent-indigo-600" checked={!!done[i]} onChange={() => setDone((d) => ({ ...d, [i]: !d[i] }))} />
          <span className={done[i] ? 'line-through text-slate-400 dark:text-slate-600' : ''}>{t}</span>
        </label>
      ))}
    </div>
  )
}
