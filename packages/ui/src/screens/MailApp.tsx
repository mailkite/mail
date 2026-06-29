import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageRow, Folder } from '@mailkite/core'
import { Moon, Sun, Settings as SettingsIcon, Users, ArrowLeft, BookOpen } from 'lucide-react'
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

/** Back bar shown atop the settings/profile/teams routes — router.back(). */
function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
        <ArrowLeft size={14} /> Back
      </button>
      <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{label}</span>
    </div>
  )
}

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
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem('mailkite.rail.collapsed') === '1' } catch { return false }
  })
  const isAdmin = user?.role === 'admin'
  const { resolved, setMode } = useTheme()

  useEffect(() => { try { localStorage.setItem('mailkite.rail.collapsed', railCollapsed ? '1' : '0') } catch { /* no-op */ } }, [railCollapsed])

  // Below this width there isn't room for rail + list + reading + assistant, so
  // expanding the menu while reading closes the message. Huge monitors keep both.
  const HUGE = 1536
  const isHuge = () => typeof window !== 'undefined' && window.innerWidth >= HUGE

  // Opening a message from the list auto-collapses the rail to icons (room for
  // reading) — but only on non-huge screens; big monitors keep the rail as-is.
  const hadSelection = useRef(false)
  useEffect(() => {
    const has = !!selected
    if (has && !hadSelection.current && !isHuge()) setRailCollapsed(true)
    hadSelection.current = has
  }, [selected])

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
  // Router-style back: pop history (popstate re-syncs state); fall back to home.
  function goBackHistory() { if (typeof history !== 'undefined' && history.length > 1) history.back(); else goHome() }
  function goFolder(f: Folder) { navigate({ kind: 'folder', folder: f }); setView('mail'); setSelected(null); setFolder(f) }
  // Toggle the rail. Expanding while reading on a non-huge screen closes the
  // message detail to make room; huge monitors keep it open.
  function toggleRail() {
    const next = !railCollapsed
    if (!next && selected && !isHuge()) goBack()
    setRailCollapsed(next)
  }
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
        // Reading mode: J/K step to the next/prev message and open it beside the
        // list; E archives the open one and advances; arrows stay free to scroll.
        const idx = messages.findIndex((x) => x.id === selected.id)
        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') { e.preventDefault(); const n = messages[idx + 1]; if (n) openMessage(n) }
        else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') { e.preventDefault(); const p = idx > 0 ? messages[idx - 1] : undefined; if (p) openMessage(p) }
        else if (e.key === 'e' || e.key === 'E') {
          e.preventDefault()
          const next = messages[idx + 1] ?? (idx > 0 ? messages[idx - 1] : undefined)
          setMessages((prev) => prev.filter((x) => x.id !== selected.id))
          api.updateFlags(selected.id, { archived: true }).catch(() => load())
          if (next) openMessage(next); else goBack()
        }
        else if ((e.key === 'r' || e.key === 'R') && canSend) { e.preventDefault(); reply(selected) }
        else if (e.key === 'Escape') { e.preventDefault(); goBackHistory() }
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
          <Logo name="MailKite" />
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
        <a href="/redesign.html" target="_blank" rel="noopener noreferrer" aria-label="Design docs" title="Design docs" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
          <BookOpen size={16} />
        </a>
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
        <div className="flex min-h-0 flex-1 flex-col"><BackBar label="Settings" onBack={goBackHistory} /><div className="flex-1 overflow-y-auto"><Settings /></div></div>
      ) : view === 'teams' ? (
        <div className="flex min-h-0 flex-1 flex-col"><BackBar label="Teams" onBack={goBackHistory} /><div className="flex-1 overflow-y-auto"><TeamAdmin /></div></div>
      ) : view === 'profile' && user ? (
        <div className="flex min-h-0 flex-1 flex-col"><BackBar label="Account" onBack={goBackHistory} /><div className="flex-1 overflow-y-auto"><Profile user={user} onLogout={onLogout ?? (() => {})} /></div></div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            {/* Left rail — fixed collapsible aside (icons when collapsed). */}
            <aside className={'shrink-0 border-r border-slate-200 transition-[width] duration-200 dark:border-slate-800 ' + (railCollapsed ? 'w-14' : 'w-56')}>
              <LeftRail
                folder={folder}
                onFolder={goFolder}
                inboxCount={messages.filter((m) => m.unread).length}
                canCompose={canSend}
                onCompose={() => setDraft({ to: '', subject: '' })}
                collapsed={railCollapsed}
                onToggle={toggleRail}
              />
            </aside>

            {/* Content — list, then (when reading) the message opens to its right. */}
            <div className="min-w-0 flex-1">
              <ResizablePanelGroup key={selected ? 'reading' : 'list'} orientation="horizontal" className="h-full">
                <ResizablePanel id="list" defaultSize={selected ? '34%' : '68%'} minSize="22%">
                  <TriageList
                    messages={messages}
                    loading={loading}
                    error={error}
                    cursor={cursor}
                    selectedId={selected?.id}
                    title={query ? `Search · “${query}”` : meta.title}
                    subtitle={query ? `${messages.length} result${messages.length === 1 ? '' : 's'}` : meta.subtitle}
                    onOpen={openMessage}
                    onStar={toggleStar}
                    onLater={dismiss}
                    onAside={dismiss}
                  />
                </ResizablePanel>
                {selected && (
                  <>
                    <ResizableHandle withHandle />
                    <ResizablePanel id="reading" defaultSize="42%" minSize="28%">
                      <ReadingPane
                        message={selected}
                        canSend={canSend}
                        onBack={goBackHistory}
                        onReply={(m) => reply(m)}
                        onStar={toggleStar}
                        onArchive={archive}
                        onLater={dismiss}
                        onAside={dismiss}
                      />
                    </ResizablePanel>
                  </>
                )}
                <ResizableHandle withHandle />
                <ResizablePanel id="assistant" defaultSize={selected ? '24%' : '32%'} minSize="18%" maxSize="42%">
                  <AssistantPanel message={selected} canSend={canSend} onSmartReply={(t) => selected && reply(selected, t)} />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>

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
