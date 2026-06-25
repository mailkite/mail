import { useCallback, useEffect, useState } from 'react'
import type { MessageRow, Folder } from '@mailkite/core'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { AppShell } from './AppShell'
import { InboxList } from './InboxList'
import { MessageView } from './MessageView'
import { Compose, type ComposeDraft } from './Compose'
import { Settings } from './Settings'
import { Profile } from './Profile'

export function MailApp({ user, onLogout }: { user?: SessionUser; onLogout?: () => void }) {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [view, setView] = useState<'mail' | 'settings' | 'profile'>('mail')
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ sending: false, push: false, needsSetup: false, oauth: false, googleClientId: '', appName: 'MailKite Mail', logoUrl: '' }))
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .listMessages({ folder, q: query || undefined })
      .then(setMessages)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [folder, query])

  useEffect(() => {
    const t = setTimeout(load, query ? 200 : 0) // debounce search
    return () => clearTimeout(t)
  }, [load, query])

  async function open(m: MessageRow) {
    setSelected(m)
    if (m.unread) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, unread: 0 } : x)))
      try { await api.updateFlags(m.id, { unread: false }) } catch { /* best-effort */ }
    }
  }

  async function toggleStar(m: MessageRow) {
    const starred = m.starred ? 0 : 1
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, starred } : x)))
    if (selected?.id === m.id) setSelected({ ...m, starred })
    try { await api.updateFlags(m.id, { starred: !m.starred }) } catch { load() }
  }

  function reply(m: MessageRow) {
    const subject = m.subject ?? ''
    // Reply from the address that received it (the send-as identity).
    setDraft({
      from: m.to_addr,
      to: m.from_addr,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      inReplyTo: m.id,
    })
  }

  const canSend = config?.sending ?? false

  return (
    <AppShell
      folder={folder}
      onFolder={(f) => { setSelected(null); setFolder(f); setView('mail') }}
      query={query}
      onSearch={setQuery}
      canCompose={canSend && view === 'mail'}
      onCompose={() => setDraft({ to: '', subject: '' })}
      user={user}
      onProfile={user ? () => { setSelected(null); setView('profile') } : undefined}
      profileActive={view === 'profile'}
      onSettings={isAdmin ? () => setView('settings') : undefined}
      settingsActive={view === 'settings'}
      appName={config?.appName}
      logoUrl={config?.logoUrl}
    >
      {view === 'settings' ? (
        <Settings />
      ) : view === 'profile' && user ? (
        <Profile user={user} onLogout={onLogout ?? (() => {})} />
      ) : (
        <div className="grid grid-cols-[340px_1fr] h-full min-h-0">
          <InboxList
            messages={messages}
            selectedId={selected?.id ?? null}
            loading={loading}
            error={error}
            onSelect={open}
            onToggleStar={toggleStar}
          />
          <MessageView message={selected} canSend={canSend} onReply={reply} onToggleStar={toggleStar} />
        </div>
      )}
      {draft && <Compose draft={draft} onClose={() => setDraft(null)} />}
    </AppShell>
  )
}
