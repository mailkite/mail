import { useCallback, useEffect, useState } from 'react'
import type { MessageRow, Folder } from '@mailkite/core'
import { Moon, Sun, Settings as SettingsIcon, Users } from 'lucide-react'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { Compose, type ComposeDraft } from './Compose'
import { Settings } from './Settings'
import { Profile } from './Profile'
import { TeamAdmin } from './TeamAdmin'
import { useTheme } from '../theme/ThemeProvider'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'
import { LeftRail } from './unified/LeftRail'
import { TriageList } from './unified/TriageList'
import { ReadingPane } from './unified/ReadingPane'
import { AssistantPanel } from './unified/AssistantPanel'

const FOLDER_META: Record<Folder, { title: string; subtitle: string }> = {
  inbox: { title: 'Priority', subtitle: 'Mail from real people that needs you' },
  starred: { title: 'Starred', subtitle: 'Messages you’ve flagged' },
  archive: { title: 'Archive', subtitle: 'Everything you’ve filed away' },
}

/**
 * Unified Light — three-column, keyboard-first inbox.
 * Column 1 = Flow boxes + Views (LeftRail) · Column 2 = triage list / reading
 * pane · Column 3 = Assistant. See docs/ui-redesign-plan.md.
 */
export function MailApp({ user, onLogout }: { user?: SessionUser; onLogout?: () => void }) {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null) // open message → reading mode
  const [cursor, setCursor] = useState(0) // keyboard highlight in the list
  const [folder, setFolder] = useState<Folder>('inbox')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [view, setView] = useState<'mail' | 'settings' | 'profile' | 'teams'>('mail')
  const [canManageTeam, setCanManageTeam] = useState(false)
  const isAdmin = user?.role === 'admin'
  const { resolved, setMode } = useTheme()

  useEffect(() => {
    api.config().then(setConfig).catch(() =>
      setConfig({ sending: false, push: false, needsSetup: false, oauth: false, googleClientId: '', appName: 'MailKite Mail', logoUrl: '', openRegistration: false }),
    )
  }, [])

  useEffect(() => {
    if (isAdmin) { setCanManageTeam(false); return }
    api.teams().then((r) => setCanManageTeam(r.teams.some((t) => t.myRole === 'admin'))).catch(() => {})
  }, [isAdmin])

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
    const t = setTimeout(load, query ? 200 : 0)
    return () => clearTimeout(t)
  }, [load, query])

  // Keep the keyboard cursor inside the list as it changes.
  useEffect(() => { setCursor((c) => Math.min(Math.max(0, c), Math.max(0, messages.length - 1))) }, [messages])

  const canSend = config?.sending ?? false

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
    if (selected?.id === m.id) setSelected({ ...selected, starred })
    try { await api.updateFlags(m.id, { starred: !m.starred }) } catch { load() }
  }

  async function archive(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) setSelected(null)
    try { await api.updateFlags(m.id, { archived: true }) } catch { load() }
  }

  // Reply Later / Set Aside have no persistence yet (phase I2) — dismiss for the
  // session so the triage gesture feels live; they return on reload.
  function dismiss(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) setSelected(null)
  }

  function reply(m: MessageRow, text?: string) {
    const subject = m.subject ?? ''
    setDraft({ from: m.to_addr, to: m.from_addr, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, inReplyTo: m.id, text })
  }

  // Keyboard-first navigation (J/K/E/R/Enter) in the mail view.
  useEffect(() => {
    if (view !== 'mail') return
    function onKey(e: KeyboardEvent) {
      if (draft) return
      const el = e.target as HTMLElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const cur = messages[cursor]
      if (selected) {
        if (e.key === 'e' || e.key === 'E') { e.preventDefault(); archive(selected) }
        else if ((e.key === 'r' || e.key === 'R') && canSend) { e.preventDefault(); reply(selected) }
        else if (e.key === 'Escape') { e.preventDefault(); setSelected(null) }
        return
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, messages.length - 1)) }
      else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'o') { if (cur) { e.preventDefault(); open(cur) } }
      else if (e.key === 'e' || e.key === 'E') { if (cur) { e.preventDefault(); archive(cur) } }
      else if ((e.key === 'r' || e.key === 'R') && canSend) { if (cur) { e.preventDefault(); reply(cur) } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, messages, cursor, selected, draft, canSend]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = FOLDER_META[folder]

  return (
    <div className="flex h-screen flex-col bg-[#f7f8fa] text-slate-800">
      {/* Header — Ask anything (search) */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <Logo name={config?.appName} logoUrl={config?.logoUrl} className="shrink-0" />
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[13px] ring-1 ring-slate-200 focus-within:ring-indigo-300">
          <span className="text-indigo-500">✦</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything — search your mail"
            className="min-w-0 flex-1 bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
          />
          <span className="ml-auto rounded bg-white px-1.5 text-[11px] text-slate-400 ring-1 ring-slate-200">⌘K</span>
        </div>
        <button onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100">
          {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {canManageTeam && (
          <button onClick={() => { setSelected(null); setView('teams') }} aria-label="Teams" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 ' + (view === 'teams' ? 'text-indigo-600' : 'text-slate-500')}>
            <Users size={16} />
          </button>
        )}
        {isAdmin && (
          <button onClick={() => { setSelected(null); setView('settings') }} aria-label="Settings" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 ' + (view === 'settings' ? 'text-indigo-600' : 'text-slate-500')}>
            <SettingsIcon size={16} />
          </button>
        )}
        {user && (
          <button onClick={() => { setSelected(null); setView('profile') }} title="Account" aria-label="Account" className="rounded-full">
            <Avatar email={user.email} src={user.avatarUrl} size={30} />
          </button>
        )}
      </header>

      {view === 'settings' ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><Settings /></div>
      ) : view === 'teams' ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><TeamAdmin /></div>
      ) : view === 'profile' && user ? (
        <div className="min-h-0 flex-1 overflow-y-auto"><Profile user={user} onLogout={onLogout ?? (() => {})} /></div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[236px_minmax(0,1fr)_322px]">
          <LeftRail
            folder={folder}
            onFolder={(f) => { setSelected(null); setFolder(f) }}
            inboxCount={folder === 'inbox' ? messages.filter((m) => m.unread).length : undefined}
            canCompose={canSend}
            onCompose={() => setDraft({ to: '', subject: '' })}
          />
          {selected ? (
            <ReadingPane
              message={selected}
              canSend={canSend}
              onBack={() => setSelected(null)}
              onReply={(m) => reply(m)}
              onStar={toggleStar}
              onArchive={archive}
              onLater={dismiss}
              onAside={dismiss}
            />
          ) : (
            <TriageList
              messages={messages}
              loading={loading}
              error={error}
              cursor={cursor}
              title={query ? `Search · “${query}”` : meta.title}
              subtitle={query ? `${messages.length} result${messages.length === 1 ? '' : 's'}` : meta.subtitle}
              onOpen={open}
              onStar={toggleStar}
              onLater={dismiss}
              onAside={dismiss}
            />
          )}
          <AssistantPanel message={selected} canSend={canSend} onSmartReply={(t) => selected && reply(selected, t)} />
        </div>
      )}

      {draft && <Compose draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
