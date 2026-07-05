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
    <article className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-panel)_60%,transparent)] px-4 py-2.5">
        <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <Act label="↩ Reply later" tone="amber" onClick={() => onLater(message)} />
          <Act label="📎 Set aside" onClick={() => onAside(message)} />
          <Act label="🗄 Archive" onClick={() => onArchive(message)} />
          <button onClick={() => onStar(message)} aria-label="Star" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]">
            <Star size={15} className={message.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
          {canSend && (
            <button onClick={() => onReply(message)} className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90">
              <Reply size={14} /> Reply
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-panel)] px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
            {encrypted && (
              <LockKeyhole size={15} className="shrink-0 text-[var(--color-muted)]" aria-label="Encrypted at rest" />
            )}
            {message.subject || '(no subject)'}
          </h1>
          <div className="mt-1 text-sm text-[var(--color-muted)]">
            <span className="font-medium text-[var(--color-text)]">{senderName(message.from_addr)}</span>{' '}
            <span className="text-[var(--color-muted)]">&lt;{message.from_addr}&gt;</span> → {message.to_addr}
            <span className="ml-2 text-[var(--color-muted)]">· {fmtTime(message.received_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {(['spf', 'dkim', 'dmarc'] as const).map((k) =>
              message[k] ? (
                <span key={k} className="rounded border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 uppercase text-[var(--color-muted)]">
                  {k} {message[k]}
                </span>
              ) : null,
            )}
          </div>
        </header>
        <div className="docs-prose mx-auto max-w-3xl px-6 py-6 text-[var(--color-text)]">
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
      : 'bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] text-[var(--color-text)] ring-1 ring-[var(--color-border)] hover:bg-[color-mix(in_oklab,var(--color-border)_55%,transparent)]'
  return (
    <button onClick={onClick} className={'rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ' + cls}>
      {label}
    </button>
  )
}
