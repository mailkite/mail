import { useEffect, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen, CornerDownLeft, Plus, X } from 'lucide-react'
import type { MessageRow } from '@mailkite/core'
import { api, type ChatTurn, type Todo } from '../../lib/api'
import { senderName, snippet } from './util'

/**
 * Unified Light · Column 3 — the Assistant.
 * Summary (AI, cached server-side), a persisted editable to-do list (AI-seeded, then user-owned:
 * check off / edit / add / delete), and a grounded chat. Smart replies live under the message in
 * the reading pane, not here. The header badge shows the real backing provider (never a
 * misleading "on-device" claim, since mail content is sent to that hosted provider).
 * Collapses to an icon rail (mirroring the LeftRail) via `collapsed`/`onToggle`.
 */
export function AssistantPanel({
  message,
  enabled,
  provider,
  collapsed,
  onToggle,
}: {
  message: MessageRow | null
  enabled?: boolean
  provider?: string
  collapsed?: boolean
  onToggle?: () => void
}) {
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 bg-gradient-to-b from-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] to-[var(--color-panel)] p-2">
        <button
          onClick={onToggle}
          aria-label="Expand assistant"
          title="Expand assistant"
          className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]"
        >
          <PanelRightOpen size={16} />
        </button>
        <div className="my-1 h-px w-6 bg-[var(--color-border)]" />
        <button
          onClick={onToggle}
          aria-label="Assistant"
          title="Assistant"
          className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-[14px] text-white shadow-sm transition hover:brightness-110"
        >
          ✦
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[color-mix(in_oklab,var(--color-accent)_8%,transparent)] to-[var(--color-panel)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-2)] text-[12px] text-white">✦</div>
        <span className="text-[13px] font-semibold text-[var(--color-text)]">Assistant</span>
        <ProviderBadge enabled={enabled} provider={provider} />
        {onToggle && (
          <button
            onClick={onToggle}
            aria-label="Collapse assistant"
            title="Collapse assistant"
            className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)] hover:text-[var(--color-muted)]"
          >
            <PanelRightClose size={15} />
          </button>
        )}
      </div>

      {!message ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-[12.5px] text-[var(--color-muted)]">
          Open a message and the assistant will summarize it, pull out to-dos, and answer questions.
        </div>
      ) : (
        <MessageAssistant message={message} enabled={!!enabled} />
      )}
    </div>
  )
}

/** Header badge: the real provider name when configured, a muted "AI off" otherwise. */
function ProviderBadge({ enabled, provider }: { enabled?: boolean; provider?: string }) {
  if (!enabled) {
    return (
      <span
        title="No AI provider configured — set one in Settings"
        className="rounded-md bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] ring-1 ring-[var(--color-border)]"
      >
        AI off
      </span>
    )
  }
  const label = provider || 'AI'
  return (
    <span
      title={`Powered by ${label}. Message content is sent to your configured AI provider when you use the assistant.`}
      className="rounded-md bg-[color-mix(in_oklab,var(--color-accent)_16%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] ring-1 ring-[color-mix(in_oklab,var(--color-accent)_35%,transparent)]"
    >
      {label}
    </span>
  )
}

/** Per-message body: AI summary + persisted to-dos + chat. */
function MessageAssistant({ message, enabled }: { message: MessageRow; enabled: boolean }) {
  const [summary, setSummary] = useState<Async<string>>(enabled ? { state: 'loading' } : { state: 'idle' })

  useEffect(() => {
    if (!enabled) return
    let live = true
    setSummary({ state: 'loading' })
    api.aiSummary(message.id).then((s) => live && setSummary({ state: 'ok', data: s })).catch((e) => live && setSummary(fail(e)))
    return () => { live = false }
  }, [message.id, enabled])

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <Card label={enabled ? '✦ Summary' : 'Preview'} labelTone="indigo">
          {!enabled ? (
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
              <b className="text-[var(--color-text)]">{senderName(message.from_addr)}</b> — {snippet(message, 220) || '(no preview)'}
            </p>
          ) : (
            <AsyncText
              value={summary}
              lines={2}
              empty="No summary."
              render={(s) => <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-text)]">{s}</p>}
            />
          )}
        </Card>

        <Card label="✦ To-dos">
          <TodoList messageId={message.id} />
        </Card>
      </div>

      <ChatBar messageId={message.id} enabled={enabled} />
    </>
  )
}

// ---- Persisted, editable to-dos --------------------------------------------
function TodoList({ messageId }: { messageId: string }) {
  const [todos, setTodos] = useState<Async<Todo[]>>({ state: 'loading' })
  const [newText, setNewText] = useState('')
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setTodos({ state: 'loading' })
    setAdding(false)
    setNewText('')
    api.listTodos(messageId).then((t) => live && setTodos({ state: 'ok', data: t })).catch((e) => live && setTodos(fail(e)))
    return () => { live = false }
  }, [messageId])

  useEffect(() => { if (adding) addRef.current?.focus() }, [adding])

  const items = todos.state === 'ok' ? todos.data : []
  const setItems = (fn: (list: Todo[]) => Todo[]) =>
    setTodos((s) => (s.state === 'ok' ? { state: 'ok', data: fn(s.data) } : s))

  async function toggle(t: Todo) {
    setItems((list) => list.map((x) => (x.id === t.id ? { ...x, done: t.done ? 0 : 1 } : x)))
    try { await api.updateTodo(t.id, { done: !t.done }) } catch { /* best-effort */ }
  }
  async function saveEdit(t: Todo, text: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed === t.text) return
    setItems((list) => list.map((x) => (x.id === t.id ? { ...x, text: trimmed } : x)))
    try { await api.updateTodo(t.id, { text: trimmed }) } catch { /* best-effort */ }
  }
  async function remove(t: Todo) {
    setItems((list) => list.filter((x) => x.id !== t.id))
    try { await api.deleteTodo(t.id) } catch { /* best-effort */ }
  }
  async function commitAdd() {
    const text = newText.trim()
    setNewText('')
    setAdding(false)
    if (!text) return
    try {
      const todo = await api.addTodo(messageId, text)
      setTodos((s) => (s.state === 'ok' ? { state: 'ok', data: [...s.data, todo] } : { state: 'ok', data: [todo] }))
    } catch { /* best-effort */ }
  }

  if (todos.state === 'loading') return <Shimmer lines={2} />
  if (todos.state === 'error') return <ErrorNote message={todos.message} />

  return (
    <div className="mt-2 space-y-1">
      {items.length === 0 && !adding && (
        <p className="text-[12px] text-[var(--color-muted)]">No action items yet.</p>
      )}
      {items.map((t) => (
        <TodoItem key={t.id} todo={t} onToggle={() => toggle(t)} onSave={(text) => saveEdit(t, text)} onDelete={() => remove(t)} />
      ))}

      {adding ? (
        <input
          ref={addRef}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAdd() } else if (e.key === 'Escape') { setAdding(false); setNewText('') } }}
          onBlur={commitAdd}
          placeholder="New to-do…"
          className="w-full rounded-md bg-[var(--color-panel)] px-2 py-1 text-[12.5px] text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-1 flex items-center gap-1 text-[12px] font-medium text-[var(--color-accent)] transition hover:opacity-80"
        >
          <Plus size={13} /> Add to-do
        </button>
      )}
    </div>
  )
}

function TodoItem({ todo, onToggle, onSave, onDelete }: { todo: Todo; onToggle: () => void; onSave: (text: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(todo.text)
  useEffect(() => setText(todo.text), [todo.text])

  return (
    <div className="group flex items-start gap-2 text-[12.5px]">
      <input
        type="checkbox"
        className="mt-0.5 accent-[var(--color-accent)]"
        checked={!!todo.done}
        onChange={onToggle}
        aria-label={todo.done ? 'Mark not done' : 'Mark done'}
      />
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(text); setEditing(false) } else if (e.key === 'Escape') { setText(todo.text); setEditing(false) } }}
          onBlur={() => { onSave(text); setEditing(false) }}
          className="min-w-0 flex-1 rounded bg-[var(--color-panel)] px-1.5 py-0.5 text-[var(--color-text)] outline-none ring-1 ring-[var(--color-accent)]"
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          title="Click to edit"
          className={'min-w-0 flex-1 cursor-text ' + (todo.done ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-text)]')}
        >
          {todo.text}
        </span>
      )}
      <button
        onClick={onDelete}
        aria-label="Delete to-do"
        title="Delete"
        className="shrink-0 rounded p-0.5 text-[var(--color-muted)] opacity-0 transition hover:text-red-500 group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  )
}

// ---- Chat input + exchange -------------------------------------------------
function ChatBar({ messageId, enabled }: { messageId: string; enabled: boolean }) {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTurns([]); setError(null) }, [messageId])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [turns, busy])

  async function submit() {
    const text = input.trim()
    if (!text || busy || !enabled) return
    const next = [...turns, { role: 'user' as const, content: text }]
    setTurns(next)
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const reply = await api.aiAssistant(messageId, next)
      setTurns((t) => [...t, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assistant failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="shrink-0 border-t border-[var(--color-border)] p-3">
      {(turns.length > 0 || busy || error) && (
        <div ref={scrollRef} className="mb-2 max-h-52 space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === 'user'
                  ? 'ml-6 rounded-xl rounded-br-sm bg-[var(--color-accent)] px-3 py-2 text-[12.5px] text-white'
                  : 'mr-6 rounded-xl rounded-bl-sm bg-[var(--color-panel)] px-3 py-2 text-[12.5px] text-[var(--color-text)] ring-1 ring-[var(--color-border)]'
              }
            >
              {t.content}
            </div>
          ))}
          {busy && <div className="mr-6 rounded-xl rounded-bl-sm bg-[var(--color-panel)] px-3 py-2 text-[12.5px] text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">Thinking…</div>}
          {error && <div className="mr-6 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-500 ring-1 ring-red-500/20">{error}</div>}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-xl bg-[var(--color-panel)] px-3 py-2 text-[12.5px] ring-1 ring-[var(--color-border)] focus-within:ring-[var(--color-accent)]">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          disabled={!enabled || busy}
          placeholder={enabled ? 'Ask or instruct…' : 'Connect an AI provider in Settings'}
          className="min-w-0 flex-1 bg-transparent text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)] disabled:cursor-not-allowed"
        />
        <button
          onClick={submit}
          disabled={!enabled || busy || !input.trim()}
          aria-label="Send"
          title="Send"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          <CornerDownLeft size={14} />
        </button>
      </div>
    </div>
  )
}

// ---- Small async-state plumbing --------------------------------------------
type Async<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string }
const fail = (e: unknown): Async<never> => ({ state: 'error', message: e instanceof Error ? e.message : 'failed' })

function Shimmer({ lines }: { lines: number }) {
  return (
    <div className="mt-2 space-y-1.5">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-[color-mix(in_oklab,var(--color-border)_45%,transparent)]" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  )
}

/** Render a scalar async value (summary): shimmer → error → empty → content. */
function AsyncText({ value, lines, empty, render }: { value: Async<string>; lines: number; empty: string; render: (v: string) => React.ReactNode }) {
  if (value.state === 'loading' || value.state === 'idle') return <Shimmer lines={lines} />
  if (value.state === 'error') return <ErrorNote message={value.message} />
  return value.data.trim() ? <>{render(value.data)}</> : <EmptyNote text={empty} />
}

function ErrorNote({ message }: { message: string }) {
  return <p className="mt-1.5 text-[12px] text-red-500">{message}</p>
}
function EmptyNote({ text }: { text: string }) {
  return <p className="mt-1.5 text-[12px] text-[var(--color-muted)]">{text}</p>
}

function Card({
  label,
  labelTone,
  children,
}: {
  label: string
  labelTone?: 'indigo'
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-[var(--color-panel)] p-3 shadow-sm ring-1 ring-[var(--color-border)]">
      <div className="flex items-center justify-between">
        <span className={'text-[11px] font-semibold uppercase tracking-wide ' + (labelTone === 'indigo' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]')}>
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}
