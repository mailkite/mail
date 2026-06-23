import { useEffect, useState } from 'react'
import type { MessageRow } from '@mailkite/core'
import { api } from '../lib/api'
import { AppShell } from './AppShell'
import { InboxList } from './InboxList'
import { MessageView } from './MessageView'
import { Compose, type ComposeDraft } from './Compose'

export function MailApp() {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ComposeDraft | null>(null)

  useEffect(() => {
    let live = true
    api
      .listMessages()
      .then((m) => { if (live) setMessages(m) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  function reply(m: MessageRow) {
    const subject = m.subject ?? ''
    setDraft({
      to: m.from_addr,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      inReplyTo: m.id,
    })
  }

  return (
    <AppShell onCompose={() => setDraft({ to: '', subject: '' })}>
      <div className="grid grid-cols-[340px_1fr] h-full min-h-0">
        <InboxList
          messages={messages}
          selectedId={selected?.id ?? null}
          loading={loading}
          error={error}
          onSelect={setSelected}
        />
        <MessageView message={selected} onReply={reply} />
      </div>
      {draft && <Compose draft={draft} onClose={() => setDraft(null)} />}
    </AppShell>
  )
}
