import { useEffect, useState } from 'react'
import type { MessageRow } from '@mailkite/core'
import { api } from '../lib/api'
import { AppShell } from './AppShell'
import { InboxList } from './InboxList'
import { MessageView } from './MessageView'

export function MailApp() {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .listMessages()
      .then((m) => { if (live) setMessages(m) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  return (
    <AppShell>
      <div className="grid grid-cols-[340px_1fr] h-full min-h-0">
        <InboxList
          messages={messages}
          selectedId={selected?.id ?? null}
          loading={loading}
          error={error}
          onSelect={setSelected}
        />
        <MessageView message={selected} />
      </div>
    </AppShell>
  )
}
