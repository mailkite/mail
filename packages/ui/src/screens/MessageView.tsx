import { useMemo } from 'react'
import { Reply } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { sanitizeEmailHtml } from '../lib/sanitize'
import { Button } from '../components/Button'

export function MessageView({
  message,
  onReply,
}: {
  message: MessageRow | null
  onReply?: (m: MessageRow) => void
}) {
  const html = useMemo(
    () => (message?.html_body ? sanitizeEmailHtml(message.html_body) : null),
    [message],
  )

  if (!message) {
    return (
      <div className="h-full grid place-items-center text-[var(--color-muted)]">
        Select a message to read
      </div>
    )
  }

  return (
    <article className="h-full overflow-y-auto">
      <header className="border-b border-[var(--color-border)] px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-semibold">{message.subject ?? '(no subject)'}</h1>
          <Button onClick={() => onReply?.(message)}>
            <Reply size={16} /> Reply
          </Button>
        </div>
        <div className="mt-1 text-sm text-[var(--color-muted)]">
          <span className="text-[var(--color-text)]">{message.from_addr}</span> → {message.to_addr}
        </div>
        <div className="mt-2 flex gap-2 text-xs text-[var(--color-muted)]">
          {(['spf', 'dkim', 'dmarc'] as const).map((k) =>
            message[k] ? (
              <span key={k} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 uppercase">
                {k} {message[k]}
              </span>
            ) : null,
          )}
        </div>
      </header>
      <div className="docs-prose px-6 py-5 max-w-none">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-[var(--color-text)]">{message.text_body}</pre>
        )}
      </div>
    </article>
  )
}
