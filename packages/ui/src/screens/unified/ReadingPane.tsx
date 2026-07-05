import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Loader2, LockKeyhole, Reply, RotateCw, Sparkles, Star, X } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { api } from '../../lib/api'
import { parseEnvelope } from '../../lib/envelope'
import { EncryptedBody } from './EncryptedBody'
import { Kbd } from './Kbd'
import { senderName, fmtTime } from './util'

/** An in-flight (or just-sent) reply, threaded optimistically before the server
 *  confirms. Owned by MailApp; rendered at the tail of the conversation. */
export interface PendingReply {
  key: string
  threadId: string
  inReplyTo: string // the message this replies to — kept so Retry can re-send
  message: MessageRow
  status: 'sending' | 'sent' | 'error'
  error?: string
}

const isEncrypted = (m: Pick<MessageRow, 'html_body' | 'text_body'>) =>
  Boolean(parseEnvelope(m.html_body) || parseEnvelope(m.text_body))
const isOutbound = (m: MessageRow) => m.direction === 'outbound'

/** Unified Light · Column 2 in "reading" mode — the open conversation (the whole
 *  thread: received mail + our sent replies) + triage row. Sent replies thread in
 *  optimistically via `pending` and animate from "Sending…" to "Sent". */
export function ReadingPane({
  message,
  canSend,
  assistantEnabled,
  pending = [],
  refreshKey = 0,
  onBack,
  onReply,
  onAiReply,
  onSmartReply,
  onStar,
  onArchive,
  onLater,
  onAside,
  onRetry,
  onDismissPending,
}: {
  message: MessageRow
  canSend?: boolean
  assistantEnabled?: boolean
  pending?: PendingReply[]
  refreshKey?: number
  onBack: () => void
  onReply: (m: MessageRow) => void
  onAiReply: (m: MessageRow) => void
  onSmartReply?: (m: MessageRow, text: string) => void
  onStar: (m: MessageRow) => void
  onArchive: (m: MessageRow) => void
  onLater: (m: MessageRow) => void
  onAside: (m: MessageRow) => void
  onRetry?: (key: string) => void
  onDismissPending?: (key: string) => void
}) {
  // The thread. Seed with the anchor so the pane paints instantly, then hydrate
  // with the full conversation (keyed by message + a refresh bump after a send).
  const [thread, setThread] = useState<MessageRow[]>([message])
  useEffect(() => {
    let live = true
    setThread([message])
    api.getThread(message.id).then((ms) => { if (live && ms.length) setThread(ms) }).catch(() => {})
    return () => { live = false }
  }, [message.id, refreshKey])

  // Once the server copy of a sent reply lands in the refetched thread, hide its
  // optimistic placeholder — the real card takes its place with no flicker.
  const threadIds = useMemo(() => new Set(thread.map((m) => m.id)), [thread])
  const livePending = pending.filter((p) => !threadIds.has(p.message.id))

  const anyEncrypted = useMemo(() => thread.some(isEncrypted), [thread])
  // Reply to the last message that actually came in — never to our own sent reply.
  const replyTarget = useMemo(
    () => [...thread].reverse().find((m) => !isOutbound(m)) ?? message,
    [thread, message],
  )

  return (
    <article className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      <div className="@container/acts flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-panel)_60%,transparent)] px-4 py-2.5">
        <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <Act icon="↩" full="Reply later" short="later" hint="L" tone="amber" onClick={() => onLater(message)} />
          <Act icon="📎" full="Set aside" short="aside" hint="A" onClick={() => onAside(message)} />
          <Act icon="🗄" full="Archive" short="Archive" hint="E" onClick={() => onArchive(message)} />
          <button onClick={() => onStar(message)} aria-label="Star" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-muted)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]">
            <Star size={15} className={message.starred ? 'fill-amber-400 text-amber-400' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <header className="border-b border-[var(--color-border)] bg-[var(--color-panel)] px-6 py-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
            {anyEncrypted && (
              <LockKeyhole size={15} className="shrink-0 text-[var(--color-muted)]" aria-label="Encrypted at rest" />
            )}
            {message.subject || '(no subject)'}
          </h1>
          <div className="mt-1 text-sm text-[var(--color-muted)]">
            {thread.length} message{thread.length === 1 ? '' : 's'} in this conversation
          </div>
        </header>

        {/* The conversation: each message stacked oldest→newest, our sent replies
            inline (labelled "You") — one continuous thread, no separate Sent box. */}
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-6">
          {thread.map((m) => <ThreadMessage key={m.id} m={m} />)}
          {livePending.map((p) => (
            <PendingMessage
              key={p.key}
              p={p}
              onRetry={onRetry ? () => onRetry(p.key) : undefined}
              onDismiss={onDismissPending ? () => onDismissPending(p.key) : undefined}
            />
          ))}
        </div>

        {/* End-of-thread actions: AI-suggested replies + Reply / AI Reply. */}
        {canSend && (
          <div className="mx-auto max-w-3xl px-6 pb-8">
            <div className="border-t border-[var(--color-border)] pt-5">
              {assistantEnabled && onSmartReply && (
                <SmartReplies message={replyTarget} onPick={(t) => onSmartReply(replyTarget, t)} />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => onReply(replyTarget)} aria-label="Reply" title="Reply (R)" className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90">
                  <Reply size={15} /> Reply <Kbd className="bg-white/20 text-white ring-white/30">R</Kbd>
                </button>
                <button onClick={() => onAiReply(replyTarget)} aria-label="AI Reply" title="AI Reply (I)" className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110">
                  <Sparkles size={15} /> AI Reply <Kbd className="bg-white/20 text-white ring-white/30">I</Kbd>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

// One message in the conversation. Outbound (our replies) get a subtle accent
// tint and a "You" chip so the thread reads as a dialogue, still in one column.
function ThreadMessage({ m }: { m: MessageRow }) {
  const out = isOutbound(m)
  return (
    <section
      className={
        'rounded-xl border px-4 py-3 ' +
        (out
          ? 'border-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_7%,var(--color-panel))]'
          : 'border-[var(--color-border)] bg-[var(--color-panel)]')
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {out && (
          <span className="rounded bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            You
          </span>
        )}
        <span className="font-medium text-[var(--color-text)]">{senderName(m.from_addr)}</span>
        <span className="text-[var(--color-muted)]">&lt;{m.from_addr}&gt;</span>
        <span className="text-[var(--color-muted)]">→ {m.to_addr}</span>
        <span className="ml-auto shrink-0 text-[var(--color-muted)]">{fmtTime(m.received_at)}</span>
      </div>
      {!out && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
          {(['spf', 'dkim', 'dmarc'] as const).map((k) =>
            m[k] ? (
              <span key={k} className="rounded border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 uppercase text-[var(--color-muted)]">
                {k} {m[k]}
              </span>
            ) : null,
          )}
        </div>
      )}
      <div className="docs-prose mt-3 text-[var(--color-text)]">
        <EncryptedBody htmlBody={m.html_body} textBody={m.text_body} />
      </div>
    </section>
  )
}

// An optimistic sent reply — appears the instant Send is pressed, animates in,
// pulses while sending, then flips to a "Sent" check. Errors offer Retry/Dismiss.
function PendingMessage({
  p,
  onRetry,
  onDismiss,
}: {
  p: PendingReply
  onRetry?: () => void
  onDismiss?: () => void
}) {
  const m = p.message
  const err = p.status === 'error'
  return (
    <section
      className={
        'reply-in rounded-xl border px-4 py-3 transition-opacity ' +
        (err
          ? 'border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10'
          : 'border-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_7%,var(--color-panel))] ' +
            (p.status === 'sending' ? 'opacity-80' : ''))
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="rounded bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
          You
        </span>
        <span className="font-medium text-[var(--color-text)]">{senderName(m.from_addr)}</span>
        <span className="text-[var(--color-muted)]">→ {m.to_addr}</span>
        <span className="ml-auto shrink-0"><SendStatus status={p.status} /></span>
      </div>
      <div className="docs-prose mt-3 whitespace-pre-wrap text-[var(--color-text)]">{m.text_body}</div>
      {err && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-rose-600 dark:text-rose-400">
          <span className="truncate">{p.error || 'Failed to send'}</span>
          {onRetry && (
            <button onClick={onRetry} className="ml-auto flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-500">
              <RotateCw size={11} /> Retry
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} aria-label="Dismiss" className="rounded-md px-1.5 py-1 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// The little status pill on a pending reply. Spinner → check, with the check
// popping in so "sent" registers as a beat, not a silent swap.
function SendStatus({ status }: { status: PendingReply['status'] }) {
  if (status === 'sending') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--color-muted)]">
        <Loader2 size={12} className="animate-spin" /> Sending…
      </span>
    )
  }
  if (status === 'sent') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Check size={12} className="sent-pop" /> Sent
      </span>
    )
  }
  return <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Failed</span>
}

// AI smart replies shown under the message. Cached server-side, so re-opening a message is free.
// Picking one prefills the composer via onPick. Silent when there's nothing to suggest.
function SmartReplies({ message, onPick }: { message: MessageRow; onPick: (text: string) => void }) {
  const [replies, setReplies] = useState<string[] | null>(null)

  useEffect(() => {
    let live = true
    setReplies(null)
    api.aiSmartReplies(message.id).then((r) => live && setReplies(r)).catch(() => live && setReplies([]))
    return () => { live = false }
  }, [message.id])

  if (replies === null) {
    return (
      <div className="mb-4 flex flex-wrap gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-40 animate-pulse rounded-full bg-[color-mix(in_oklab,var(--color-border)_45%,transparent)]" />
        ))}
      </div>
    )
  }
  if (replies.length === 0) return null

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        <Sparkles size={12} /> Suggested replies
      </div>
      <div className="flex flex-wrap gap-2">
        {replies.map((r) => (
          <button
            key={r}
            onClick={() => onPick(r)}
            className="rounded-full bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] px-3 py-1.5 text-[12.5px] text-[var(--color-text)] ring-1 ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] transition hover:bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)]"
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  )
}

// Triage action. Collapses with the toolbar (container `acts`): full label →
// short label (later/aside) → icon-only, so the row never wraps in a tight pane.
function Act({
  icon,
  full,
  short,
  hint,
  onClick,
  tone,
}: {
  icon: string
  full: string
  short: string
  hint?: string
  onClick: () => void
  tone?: 'amber'
}) {
  const amber = tone === 'amber'
  const cls = amber
    ? 'bg-amber-400 text-amber-950 hover:bg-amber-300'
    : 'bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] text-[var(--color-text)] ring-1 ring-[var(--color-border)] hover:bg-[color-mix(in_oklab,var(--color-border)_55%,transparent)]'
  return (
    <button
      onClick={onClick}
      aria-label={full}
      title={hint ? `${full} (${hint})` : full}
      className={'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition ' + cls}
    >
      <span aria-hidden>{icon}</span>
      <span className="hidden @min-[44rem]/acts:inline">{full}</span>
      <span className="hidden @min-[32rem]/acts:inline @min-[44rem]/acts:hidden">{short}</span>
      {hint && (
        <Kbd className={'hidden @min-[32rem]/acts:inline-grid ' + (amber ? 'bg-amber-950/10 text-amber-950/70 ring-amber-950/20' : '')}>{hint}</Kbd>
      )}
    </button>
  )
}
