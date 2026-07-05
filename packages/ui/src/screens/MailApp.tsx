import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageRow, Folder } from '@mailkite/core'
import { Settings as SettingsIcon, Users, ArrowLeft, BookOpen } from 'lucide-react'
import { api, type AppConfig, type SessionUser } from '../lib/api'
import { Compose, type ComposeDraft } from './Compose'
import { Settings } from './Settings'
import { Profile } from './Profile'
import { TeamAdmin } from './TeamAdmin'
import { ThemeMenu } from '../components/ThemeMenu'
import { Avatar } from '../components/Avatar'
import { Logo } from '../components/Logo'
import { LeftRail } from './unified/LeftRail'
import { TriageList } from './unified/TriageList'
import { ReadingPane } from './unified/ReadingPane'
import { ReplyPanel } from './unified/ReplyPanel'
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
  | { kind: 'reply'; id: string }
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
  const reply = p.match(/^\/m\/(.+)\/reply$/)
  if (reply) return { kind: 'reply', id: decodeURIComponent(reply[1]) }
  const msg = p.match(/^\/m\/(.+)$/)
  if (msg) return { kind: 'message', id: decodeURIComponent(msg[1]) }
  return { kind: 'folder', folder: 'inbox' } // '/' and '/inbox'
}

function pathFor(r: Route): string {
  switch (r.kind) {
    case 'settings': return '/settings'
    case 'profile': return '/profile'
    case 'teams': return '/teams'
    case 'reply': return `/m/${encodeURIComponent(r.id)}/reply`
    case 'message': return `/m/${encodeURIComponent(r.id)}`
    case 'folder': return r.folder === 'inbox' ? '/inbox' : `/${r.folder}`
  }
}

const reSubject = (s: string | null) => { const x = s ?? ''; return /^re:/i.test(x) ? x : `Re: ${x}` }
const initialRoute = parseRoute(typeof location !== 'undefined' ? location.pathname : '/')

/** Back bar shown atop the settings/profile/teams routes — history.back(). */
function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5">
      <button onClick={onBack} aria-label="Back" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-text)]">
        <ArrowLeft size={14} /> Back
      </button>
      <span className="text-[13px] font-semibold text-[var(--color-text)]">{label}</span>
    </div>
  )
}

/**
 * Unified Light — keyboard-first inbox. The URL is the single source of truth:
 * every drill level is a route (/inbox · /m/:id · /m/:id/reply · /settings …),
 * the panel layout + which panel is collapsed are derived from it, and "back"
 * (button, Esc/Backspace, browser) is always history.back(). See
 * docs/ui-redesign-plan.md.
 */
export function MailApp({ user, onLogout }: { user?: SessionUser; onLogout?: () => void }) {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [selected, setSelected] = useState<MessageRow | null>(null)
  const [replying, setReplying] = useState(initialRoute.kind === 'reply')
  const [replyText, setReplyText] = useState('')
  const [cursor, setCursor] = useState(0)
  const [folder, setFolder] = useState<Folder>(initialRoute.kind === 'folder' ? initialRoute.folder : 'inbox')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ComposeDraft | null>(null) // Compose modal (new message)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [view, setView] = useState<View>(
    initialRoute.kind === 'settings' || initialRoute.kind === 'profile' || initialRoute.kind === 'teams' ? initialRoute.kind : 'mail',
  )
  const [canManageTeam, setCanManageTeam] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try { return localStorage.getItem('mailkite.rail.collapsed') === '1' } catch { return false }
  })
  const [assistantCollapsed, setAssistantCollapsed] = useState(() => {
    try { return localStorage.getItem('mailkite.assistant.collapsed') === '1' } catch { return false }
  })
  const isAdmin = user?.role === 'admin'

  const selectedRef = useRef<MessageRow | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const savedDrafts = useRef<Record<string, string>>({}) // message id → unsent reply text

  useEffect(() => { try { localStorage.setItem('mailkite.rail.collapsed', railCollapsed ? '1' : '0') } catch { /* no-op */ } }, [railCollapsed])
  useEffect(() => { try { localStorage.setItem('mailkite.assistant.collapsed', assistantCollapsed ? '1' : '0') } catch { /* no-op */ } }, [assistantCollapsed])

  // Below this width there's no room for rail + list + reading + assistant, so a
  // message forces the rail to icons; huge monitors keep the user's preference.
  const HUGE = 1536
  const isHuge = () => typeof window !== 'undefined' && window.innerWidth >= HUGE
  const railShown = selected && !isHuge() ? true : railCollapsed

  useEffect(() => {
    api.config().then(setConfig).catch(() =>
      setConfig({ sending: false, push: false, needsSetup: false, oauth: false, googleClientId: '', githubClientId: '', appName: 'MailKite Mail', logoUrl: '', openRegistration: false }),
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

  // Keep the unsent reply saved as a draft, keyed by message, so leaving /reply
  // (back, browser, switching) never loses it.
  useEffect(() => {
    if (!replying || !selected) return
    const id = selected.id
    if (replyText.trim()) savedDrafts.current[id] = replyText
    else delete savedDrafts.current[id]
  }, [replyText, replying, selected])

  const canSend = config?.sending ?? false

  function showMessage(m: MessageRow) {
    setSelected(m)
    if (m.unread) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, unread: 0 } : x)))
      api.updateFlags(m.id, { unread: false }).catch(() => {})
    }
  }

  // Reconstruct UI state from the URL (mount + back/forward). No history push.
  const applyRoute = useCallback((r: Route) => {
    if (r.kind === 'settings' || r.kind === 'profile' || r.kind === 'teams') { setReplying(false); setSelected(null); setView(r.kind); return }
    if (r.kind === 'folder') { setView('mail'); setReplying(false); setSelected(null); setFolder(r.folder); return }
    // message | reply
    setView('mail')
    setReplying(r.kind === 'reply')
    if (r.kind === 'reply') setReplyText(savedDrafts.current[r.id] ?? '')
    if (selectedRef.current?.id !== r.id) {
      api.getMessage(r.id).then(showMessage).catch(() => setSelected(null))
    }
  }, [])

  useEffect(() => {
    applyRoute(parseRoute(location.pathname))
    const onPop = () => applyRoute(parseRoute(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [applyRoute])

  function push(r: Route) { try { history.pushState({}, '', pathFor(r)) } catch { /* no-op */ } }
  function goBackHistory() { if (typeof history !== 'undefined' && history.length > 1) history.back(); else goHome() }
  function goHome() { push({ kind: 'folder', folder: 'inbox' }); setView('mail'); setReplying(false); setSelected(null); setFolder('inbox') }
  function goFolder(f: Folder) { push({ kind: 'folder', folder: f }); setView('mail'); setReplying(false); setSelected(null); setFolder(f) }
  function goView(v: Exclude<View, 'mail'>) { push({ kind: v }); setReplying(false); setSelected(null); setView(v) }
  function openMessage(m: MessageRow) { push({ kind: 'message', id: m.id }); setView('mail'); setReplying(false); showMessage(m) }
  function startReply(m: MessageRow, text?: string) {
    push({ kind: 'reply', id: m.id })
    setView('mail'); setReplying(true)
    setReplyText(text ?? savedDrafts.current[m.id] ?? '')
    showMessage(m)
  }
  function onReplySent() {
    if (selected) delete savedDrafts.current[selected.id]
    setReplyText('')
    goBackHistory() // /reply → /m/:id
  }
  // Toggle rail. With a message open on a screen too narrow to hold the expanded
  // menu beside it, "expand" returns to the list (which frees the width) and shows
  // the menu expanded. Use goFolder — not history.back() — so it lands on the list
  // deterministically even after paging through several messages, which would
  // otherwise step back onto another message and leave the menu collapsed. Wide
  // screens just flip the preference in place, leaving the detail open.
  function toggleRail() {
    if (selected && !isHuge()) { setRailCollapsed(false); goFolder(folder); return }
    setRailCollapsed((c) => !c)
  }
  function toggleAssistant() { setAssistantCollapsed((c) => !c) }

  async function toggleStar(m: MessageRow) {
    const starred = m.starred ? 0 : 1
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, starred } : x)))
    if (selected?.id === m.id) setSelected({ ...selected, starred })
    try { await api.updateFlags(m.id, { starred: !m.starred }) } catch { load() }
  }

  async function archive(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) goBackHistory()
    try { await api.updateFlags(m.id, { archived: true }) } catch { load() }
  }

  // Reply Later / Set Aside have no persistence yet (phase I2) — dismiss for the
  // session so the gesture feels live; they return on reload.
  function dismiss(m: MessageRow) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
    if (selected?.id === m.id) goBackHistory()
  }

  // Keyboard-first navigation. Esc/Backspace = back; box digits; J/K + arrows.
  useEffect(() => {
    if (view !== 'mail') return
    function onKey(e: KeyboardEvent) {
      if (draft) return // Compose modal owns the keyboard
      if (e.key === 'Escape' && (selected || replying)) { e.preventDefault(); goBackHistory(); return }
      const el = e.target as HTMLElement
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Backspace') { e.preventDefault(); goBackHistory(); return }
      if (replying) return // composing — no nav shortcuts
      if (e.key === '1') { e.preventDefault(); goFolder('inbox'); return }
      if (e.key === '2') { e.preventDefault(); goFolder('starred'); return }
      if (e.key === '3') { e.preventDefault(); goFolder('archive'); return }
      const cur = messages[cursor]
      if (selected) {
        // Reading: J/K + ↓/↑ step to next/prev and open it; E archives + advances.
        const idx = messages.findIndex((x) => x.id === selected.id)
        if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') { e.preventDefault(); const n = messages[idx + 1]; if (n) openMessage(n) }
        else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') { e.preventDefault(); const p = idx > 0 ? messages[idx - 1] : undefined; if (p) openMessage(p) }
        else if (e.key === 'e' || e.key === 'E') {
          e.preventDefault()
          const next = messages[idx + 1] ?? (idx > 0 ? messages[idx - 1] : undefined)
          setMessages((prev) => prev.filter((x) => x.id !== selected.id))
          api.updateFlags(selected.id, { archived: true }).catch(() => load())
          if (next) openMessage(next); else goBackHistory()
        }
        else if ((e.key === 'r' || e.key === 'R') && canSend) { e.preventDefault(); startReply(selected) }
        return
      }
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, messages.length - 1)) }
      else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'o') { if (cur) { e.preventDefault(); openMessage(cur) } }
      else if (e.key === 'e' || e.key === 'E') { if (cur) { e.preventDefault(); archive(cur) } }
      else if ((e.key === 'r' || e.key === 'R') && canSend) { if (cur) { e.preventDefault(); startReply(cur) } }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, messages, cursor, selected, replying, draft, canSend, folder]) // eslint-disable-line react-hooks/exhaustive-deps

  const meta = FOLDER_META[folder]

  // Content nodes — placed into different panel arrangements per drill level.
  const listNode = (
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
  )
  const readingNode = selected && (
    <ReadingPane
      message={selected}
      canSend={canSend}
      onBack={goBackHistory}
      onReply={(m) => startReply(m)}
      onStar={toggleStar}
      onArchive={archive}
      onLater={dismiss}
      onAside={dismiss}
    />
  )
  const assistantNode = <AssistantPanel message={selected} canSend={canSend} onSmartReply={(t) => selected && startReply(selected, t)} collapsed={assistantCollapsed} onToggle={toggleAssistant} />
  const drillKey = replying ? 'reply' : selected ? 'read' : 'list'

  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-2.5">
        <button onClick={goHome} aria-label="Home" title="Home" className="shrink-0">
          <Logo name="MailKite" />
        </button>
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-3 py-2 text-[13px] ring-1 ring-[var(--color-border)] focus-within:ring-[var(--color-accent)]">
          <span className="text-[var(--color-accent)]">✦</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask anything — search your mail"
            className="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
          />
          <span className="ml-auto rounded bg-[var(--color-panel)] px-1.5 text-[11px] text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">⌘K</span>
        </div>
        <a href="/redesign.html" target="_blank" rel="noopener noreferrer" aria-label="Design docs" title="Design docs" className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-text)]">
          <BookOpen size={16} />
        </a>
        <ThemeMenu />
        {canManageTeam && (
          <button onClick={() => goView('teams')} aria-label="Teams" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] ' + (view === 'teams' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')}>
            <Users size={16} />
          </button>
        )}
        {isAdmin && (
          <button onClick={() => goView('settings')} aria-label="Settings" className={'grid h-8 w-8 place-items-center rounded-lg transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] ' + (view === 'settings' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')}>
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
            <aside className={'shrink-0 border-r border-[var(--color-border)] transition-[width] duration-200 ' + (railShown ? 'w-14' : 'w-56')}>
              <LeftRail
                folder={folder}
                onFolder={goFolder}
                inboxCount={messages.filter((m) => m.unread).length}
                canCompose={canSend}
                onCompose={() => setDraft({ to: '', subject: '' })}
                collapsed={railShown}
                onToggle={toggleRail}
              />
            </aside>

            <div className="min-w-0 flex-1">
              {replying && selected ? (
                <ResizablePanelGroup key={drillKey} orientation="horizontal" className="h-full">
                  <ResizablePanel id="reading" defaultSize="42%" minSize="26%">{readingNode}</ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="reply" defaultSize="58%" minSize="34%">
                    <ReplyPanel
                      to={selected.from_addr}
                      fromDefault={selected.to_addr}
                      subject={reSubject(selected.subject)}
                      inReplyTo={selected.id}
                      text={replyText}
                      onText={setReplyText}
                      onBack={goBackHistory}
                      onSent={onReplySent}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : selected ? (
                <ResizablePanelGroup key={drillKey} orientation="horizontal" className="h-full">
                  <ResizablePanel id="list" defaultSize="40%" minSize="24%">{listNode}</ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="reading" defaultSize="60%" minSize="30%">{readingNode}</ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <div className="h-full">{listNode}</div>
              )}
            </div>

            {/* Assistant — a collapsible right rail, mirroring the LeftRail. */}
            <aside className={'shrink-0 border-l border-[var(--color-border)] transition-[width] duration-200 ' + (assistantCollapsed ? 'w-14' : 'w-80')}>
              {assistantNode}
            </aside>
          </div>

          {/* Fixed triage footer — spans the window, never scrolls. */}
          <footer className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-panel)] px-5 py-2 text-[11px]">
            <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20">↩ Reply Later</span>
            <span className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20">📎 Set Aside</span>
            <span className="ml-auto text-[var(--color-muted)]">
              {messages.length === 0 ? 'Inbox Zero ✦' : <>Inbox Zero in <b className="text-[var(--color-accent)]">{messages.length}</b></>}
            </span>
            <button
              onClick={() => messages[0] && openMessage(messages[0])}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90"
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
