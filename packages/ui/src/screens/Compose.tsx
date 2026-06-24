import { useEffect, useState } from 'react'
import { api, type SendBody } from '../lib/api'
import { Button } from '../components/Button'

export interface ComposeDraft {
  to: string
  subject: string
  from?: string
  text?: string
  inReplyTo?: string
}

export function Compose({ draft, onClose }: { draft: ComposeDraft; onClose: () => void }) {
  const [from, setFrom] = useState(draft.from ?? '')
  const [identities, setIdentities] = useState<string[]>([])
  const [to, setTo] = useState(draft.to)
  const [subject, setSubject] = useState(draft.subject)
  const [text, setText] = useState(draft.text ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load send-as identities; default From to the reply address (draft.from) or
  // the configured default.
  useEffect(() => {
    api
      .identities()
      .then(({ identities, default: dflt }) => {
        setIdentities(identities)
        setFrom((f) => f || draft.from || dflt)
      })
      .catch(() => {})
  }, [draft.from])

  async function send() {
    setSending(true)
    setError(null)
    try {
      const body: SendBody = { from: from.trim() || undefined, to, subject, text, inReplyTo: draft.inReplyTo }
      await api.send(body)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'send failed')
      setSending(false)
    }
  }

  const field =
    'w-full bg-transparent border-b border-[var(--color-border)] px-1 py-2 text-sm outline-none focus:border-[var(--color-accent)]'

  return (
    <div className="fixed inset-0 z-50 grid place-items-end justify-center bg-black/40 p-4 sm:place-items-center">
      <div className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2 text-sm font-medium">
          <span>{draft.inReplyTo ? 'Reply' : 'New message'}</span>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">✕</button>
        </div>
        <div className="px-4 py-2">
          <input
            className={field}
            placeholder="From"
            value={from}
            list="mk-identities"
            onChange={(e) => setFrom(e.target.value)}
          />
          <datalist id="mk-identities">
            {identities.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
          <input className={field} placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className={field} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea
            className="mt-2 h-48 w-full resize-none bg-transparent text-sm outline-none"
            placeholder="Write your message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {error && <p className="px-4 pb-2 text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2">
          <Button onClick={send} disabled={sending || !from || !to || !subject}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
