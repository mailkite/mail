import { useMemo } from 'react'
import { ArrowLeft, LockKeyhole, Reply, Star } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { parseEnvelope } from '../../lib/envelope'
import { EncryptedBody } from './EncryptedBody'
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
  const encrypted = useMemo(
    () => Boolean(parseEnvelope(message.html_body) || parseEnvelope(message.text_body)),
    [message],
  )

  return (
    <article className="flex h-full min-w-0 flex-col bg-[#f7f8fa] dark:bg-[#0b0f1c]">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/60 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <Act label="↩ Reply later" tone="amber" onClick={() => onLater(message)} />
          <Act label="📎 Set aside" onClick={() => onAside(message)} />
          <Act label="🗄 Archive" onClick={() => onArchive(message)} />
          <button onClick={() => onStar(message)} aria-label="Star" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
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
        <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {encrypted && (
              <LockKeyhole size={15} className="shrink-0 text-slate-400 dark:text-slate-500" aria-label="Encrypted at rest" />
            )}
            {message.subject || '(no subject)'}
          </h1>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-800 dark:text-slate-200">{senderName(message.from_addr)}</span>{' '}
            <span className="text-slate-400 dark:text-slate-500">&lt;{message.from_addr}&gt;</span> → {message.to_addr}
            <span className="ml-2 text-slate-400 dark:text-slate-500">· {fmtTime(message.received_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(['spf', 'dkim', 'dmarc'] as const).map((k) =>
              message[k] ? (
                <span key={k} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {k} {message[k]}
                </span>
              ) : null,
            )}
          </div>
        </header>
        <div className="docs-prose mx-auto max-w-3xl px-6 py-6 text-slate-800 dark:text-slate-200">
          <EncryptedBody htmlBody={message.html_body} textBody={message.text_body} />
        </div>
      </div>
    </article>
  )
}

function Act({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'amber' }) {
  const cls =
    tone === 'amber'
      ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
      : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700'
  return (
    <button onClick={onClick} className={'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ' + cls}>
      {label}
    </button>
  )
}
