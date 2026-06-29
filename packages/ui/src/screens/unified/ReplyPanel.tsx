import { useEffect, useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { api } from '../../lib/api'

/**
 * Unified Light — inline reply composer, shown as a panel to the right of the
 * message (the list collapses). Body text is controlled by the parent so it can
 * be saved as a draft when the route leaves /reply.
 */
export function ReplyPanel({
  to,
  fromDefault,
  subject: subject0,
  inReplyTo,
  text,
  onText,
  onBack,
  onSent,
}: {
  to: string
  fromDefault: string
  subject: string
  inReplyTo: string
  text: string
  onText: (t: string) => void
  onBack: () => void
  onSent: () => void
}) {
  const [from, setFrom] = useState(fromDefault)
  const [toAddr, setToAddr] = useState(to)
  const [subject, setSubject] = useState(subject0)
  const [identities, setIdentities] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.identities().then(({ identities, default: d }) => {
      setIdentities(identities)
      setFrom((f) => f || fromDefault || d)
    }).catch(() => {})
  }, [fromDefault])

  async function send() {
    setSending(true)
    setError(null)
    try {
      await api.send({ from: from.trim() || undefined, to: toAddr, subject, text, inReplyTo })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'send failed')
      setSending(false)
    }
  }

  const field =
    'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

  return (
    <div className="flex h-full flex-col bg-[#f7f8fa] dark:bg-[#0b0f1c]">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/60 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
        <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Reply</span>
        {error && <span className="truncate text-[12px] text-rose-500">{error}</span>}
        <button
          onClick={send}
          disabled={sending || !from || !toAddr || !subject}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
        >
          <Send size={13} /> {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        <input className={field} placeholder="From" value={from} list="mk-reply-ids" onChange={(e) => setFrom(e.target.value)} />
        <datalist id="mk-reply-ids">{identities.map((i) => <option key={i} value={i} />)}</datalist>
        <input className={field} placeholder="To" value={toAddr} onChange={(e) => setToAddr(e.target.value)} />
        <input className={field} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="min-h-40 flex-1 resize-none rounded-lg border border-slate-200 bg-white p-3 text-[13px] leading-relaxed text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          placeholder="Write your reply…"
          value={text}
          onChange={(e) => onText(e.target.value)}
          autoFocus
        />
      </div>
    </div>
  )
}
