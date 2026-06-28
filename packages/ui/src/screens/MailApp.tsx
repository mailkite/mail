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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/resizable'

const FOLDER_META: Record<Folder, { title: string; subtitle: string }> = {
  inbox: { title: 'Priority', subtitle: 'Mail from real people that needs you' },
  starred: { title: 'Starred', subtitle: 'Messages you’ve flagged' },
  archive: { title: 'Archive', subtitle: 'Everything you’ve filed away' },
}

type View = 'mail' | 'settings' | 'profile' | 'teams'
type Route =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'message'; id: string }
  | { kind: 'settings' }
  | { kind: 'profile' }
  | { kind: 'teams' }

function parseRoute(path: string): Route {
  const p = path.replace(/\/+$/, '') || '/'
  if (p === '/settings') return { kind: 'settings' }
  if (p === '/profile') return { kind: 'profile' }
  if (p === '/teams') return { kind: 'teams' }
  if (p === '/starred') return { kind: 'folder', folder: 'starred' }
  if (p === '/archive') return { kind: 'folder', folder: 'archive' }
  const m = p.match(/^\/m\/(.+)$/)
  if (m) return { kind: 'message', id: decodeURIComponent(m[1]) }
  return { kind: 'folder', folder: 'inbox' } // '/' and '/inbox'
}

function pathFor(r: Route): string {
  switch (r.kind) {
    case 'settings': return '/settings'
    case 'profile': return '/profile'
    case 'teams': return '/teams'
    case 'message': return `/m/${encodeURIComponent(r.id)}`
    case 'folder': return r.folder === 'inbox' ? '/inbox' : `/${r.folder}`
  }
}

const initialRoute = parseRoute(typeof location !== 'undefined' ? location.pathname : '/')

/**
 * Unified Light — three-column, keyboard-first inbox with URL routing.
 * Every surface has a route: /inbox · /starred · /archive · /m/:id (one per
 * message) · /settings · /profile · /teams. Back/forward and deep links work
 * (a /m/:id link not in the loaded list is fetched). See docs/ui-redesign-plan.md.
 */
export function MailApp({ user, onLogout }: { user?: SessionUser; onLogout?: () => void }) {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null) // open message → reading mode
  const [cursor, setCursor] = useState(0) // keyboard highlight in the list
  const [folder, setFolder] = useState<Folder>(initialRoute.kind === 'folder' ? initialRoute.folder : 'inbox')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ComposeDraft | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [view, setView] = useState<View>(
    initialRoute.kind === 'settings' || initialRoute.kind === 'profile' || initialRoute.kind === 'teams' ? initialRoute.kind : 'mail',
  )
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

  useEffect(() => { setCursor((c) => Math.min(Math.max(0, c), Math.max(0, messages.length - 1))) }, [messages])

  const canSend = config?.sending ?? false

  // Mark a message read and show it in the reading pane (no URL change here).
  function showMessage(m: MessageRow) {
    setSelected(m)
    if (m.unread) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, unread: 0 } : x)))
      api.updateFlags(m.id, { unread: false }).catch(() => {})
    }
  }

  // Apply a route to view/folder/selected without pushing history (mount + popstate).
  const applyRoute = useCallback((r: Route) => {
    if (r.kind === 'settings' || r.kind === 'profile' || r.kind === 'teams') { setSelected(null); setView(r.kind); return }
    if (r.kind === 'folder') { setView('mail'); setSelected(null); setFolder(r.folder); return }
    setView('mail')
    setSelected((cur) => {
      if (cur?.id === r.id) return cur
      api.getMessage(r.id).then(showMessage).catch(() => setSelected(null))
      return cur
    })
  }, [])

  // Sync with the URL on mount and on back/forward.
  useEffect(() => {
    applyRoute(parseRoute(location.pathname))
    const onPop = () => applyRoute(parseRoute(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [applyRoute])

  function navigate(r: Route) {
    try { history.pushState({}, '', pathFor(r)) } catch { /* no-op */ }
  }
  function goHome() { try { history.pushState({}, '', '/') } catch { /* no-op */ } ; setView('mail'); setSelected(null); setFolder('inbox') }
  function goFolder(f: Folder) { navigate({ kind: 'folder', folder: f }); setView('mail'); setSelected(null); setFolder(f) }
  function goView(v: Exclude<View, 'mail'>) { navigate({ kind: v }); setSelected(null); setView(v) }
  function openMessage(m: MessageRow) { navigate({ kind: 'message', id: m.id }); setView('mail'); showMessage(m) }
  function goBack() { goFolder(folder) }

  async function toggleStar(m: MessageRow) {
    const starred = m.starred ? 0 : 1
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, starred } : x)))
    if (selected?.id === m.id) setSelected({ ...selected, starred })
    try { await api.updateFlags(m.id, { starred: !m.starred }) } catch { load() }
  }

  async function archive(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) goBack()
    try { await api.updateFlags(m.id, { archived: true }) } catch { load() }
  }

  // Reply Later / Set Aside have no persistence yet (phase I2) — dismiss for the
  // session so the gesture feels live; they return on reload.
  function dismiss(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) goBack()
  }

  function reply(m: MessageRow, text?: string) {
    const subject = m.subject ?? ''
    setDraft({ from: m.to_addr, to: m.from_addr, subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, inReplyTo: m.id, text })
  }

  // Keyboard-first navigation (J/K/E/R/Enter/Esc) in the mail view.
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
        else if (e.key === 'Escape') { e.preventDefault(); goBack() }
        return
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, messages.length - 1)) }
      else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'o') { if (cur) { e.preventDefault(); openMessage(cur) } }
      else if (e.key === 'e' || e.key === 'E') { if (cur) { e.preventDefault(); archive(cur) } }
      else if ((e.key === 'r' || e.key === 'R') && canSend) { if (cur) { e.preventDefault(); reply(cur) } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, messages, cursor, selected, draft, canSend, folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = FOLDER_META[folder]

  return (
    <div className="flex h-screen flex-col bg-[#f7f8fa] text-slate-800 dark:bg-[#0b0f1c] dark:text-slate-200">
      {/* Header — Ask anything (search) */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <button onClick={goHome} aria-label="Home" title="Home" className="shrink-0">
          <Logo />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[13px] ring-1 ring-slate-200 focus-within:ring-indigo-300 dark:bg-slate-800 dark:ring-slate-700">
          <span className="text-indigo-500">✦</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything — search your mail"
            className="min-w-0 flex-1 bg-transparent text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
          />
          <span className="ml-auto rounded bg-white px-1.5 text-[11px] text-slate-400 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">⌘K</span>
        </div>
        <button onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {canManageTeam && (
          <button onClick={() => goView('teams')} aria-label="Teams" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 dark:hover:bg-slate-800 ' + (view === 'teams' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400')}>
            <Users size={16} />
          </button>
        )}
        {isAdmin && (
          <button onClick={() => goView('settings')} aria-label="Settings" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 dark:hover:bg-slate-800 ' + (view === 'settings' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400')}>
            <SettingsIcon size={16} />
          </button>
        )}
        {user && (
          <button onClick={() => goView('profile')} title="Account" aria-label="Account" className="rounded-full">
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
        <>
          <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
            <ResizablePanel id="rail" defaultSize="19%" minSize="14%" maxSize="26%">
              <LeftRail
                folder={folder}
                onFolder={goFolder}
                inboxCount={folder === 'inbox' ? messages.filter((m) => m.unread).length : undefined}
                canCompose={canSend}
                onCompose={() => setDraft({ to: '', subject: '' })}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="center" defaultSize="52%" minSize="32%">
              {selected ? (
                <ReadingPane
                  message={selected}
                  canSend={canSend}
                  onBack={goBack}
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
                  onOpen={openMessage}
                  onStar={toggleStar}
                  onLater={dismiss}
                  onAside={dismiss}
                />
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="assistant" defaultSize="29%" minSize="18%" maxSize="42%">
              <AssistantPanel message={selected} canSend={canSend} onSmartReply={(t) => selected && reply(selected, t)} />
            </ResizablePanel>
          </ResizablePanelGroup>

          {/* Fixed triage footer — spans the window, never scrolls. */}
          <footer className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white px-5 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900">
            <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20">↩ Reply Later</span>
            <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20">📎 Set Aside</span>
            <span className="ml-auto text-slate-400 dark:text-slate-500">
              {messages.length === 0 ? 'Inbox Zero ✦' : <>Inbox Zero in <b className="text-indigo-600">{messages.length}</b></>}
            </span>
            <button
              onClick={() => messages[0] && openMessage(messages[0])}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              Focus &amp; Reply →
            </button>
          </footer>
        </>
      )}

      {draft && <Compose draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
