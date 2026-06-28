import { useMemo } from 'react'
import { ArrowLeft, Reply, Star } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { sanitizeEmailHtml } from '../../lib/sanitize'
import { senderName, fmtTime } from './util'

/** Unified Light · Column 2 in "reading" mode — the open message + triage row. */
export function ReadingPane({
  message,
  canSend,
  onBack,
  onReply,
  onStar,
  onArchive,
  onLater,
  onAside,
}: {
  message: MessageRow
  canSend?: boolean
  onBack: () => void
  onReply: (m: MessageRow) => void
  onStar: (m: MessageRow) => void
  onArchive: (m: MessageRow) => void
  onLater: (m: MessageRow) => void
  onAside: (m: MessageRow) => void
}) {
  const html = useMemo(
    () => (message.html_body ? sanitizeEmailHtml(message.html_body) : null),
    [message],
  )

  return (
    <article className="flex h-full min-w-0 flex-col bg-[#f7f8fa]">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/60 px-4 py-2.5">
        <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-slate-600 transition hover:bg-slate-100">
          <ArrowLeft size={14} /> Inbox
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <Act label="↩ Reply later" tone="amber" onClick={() => onLater(message)} />
          <Act label="📎 Set aside" onClick={() => onAside(message)} />
          <Act label="🗄 Archive" onClick={() => onArchive(message)} />
          <button onClick={() => onStar(message)} aria-label="Star" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
            <Star size={15} className={message.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
          {canSend && (
            <button onClick={() => onReply(message)} className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-500">
              <Reply size={14} /> Reply
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-900">{message.subject || '(no subject)'}</h1>
          <div className="mt-1 text-sm text-slate-500">
            <span className="font-medium text-slate-800">{senderName(message.from_addr)}</span>{' '}
            <span className="text-slate-400">&lt;{message.from_addr}&gt;</span> → {message.to_addr}
            <span className="ml-2 text-slate-400">· {fmtTime(message.received_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(['spf', 'dkim', 'dmarc'] as const).map((k) =>
              message[k] ? (
                <span key={k} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 uppercase text-slate-500">
                  {k} {message[k]}
                </span>
              ) : null,
            )}
          </div>
        </header>
        <div className="docs-prose mx-auto max-w-3xl px-6 py-6 text-slate-800">
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-slate-800">{message.text_body}</pre>
          )}
        </div>
      </div>
    </article>
  )
}

function Act({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'amber' }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200'
  return (
    <button onClick={onClick} className={'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ' + cls}>
      {label}
    </button>
  )
}
