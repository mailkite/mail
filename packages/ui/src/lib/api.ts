import type { MessageRow, MessageFlags, Folder } from '@mailkite/core'

const base: string =
  (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? ''

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return (await res.json()) as T
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(e.error ?? `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export interface SessionUser {
  email: string
  role: 'admin' | 'user'
}

export interface AdminConfigItem {
  key: string
  secret: boolean
  gates: string | null
  source: 'env' | 'saved' | 'unset'
  value: string
}

export interface SendBody {
  to: string
  subject: string
  text?: string
  html?: string
  inReplyTo?: string
}

export interface AppConfig {
  sending: boolean
  push: boolean
  needsSetup: boolean
}

export const api = {
  config: () => getJSON<AppConfig>('/api/config'),

  // ---- auth ----------------------------------------------------------------
  me: async (): Promise<SessionUser | null> => {
    const res = await fetch(`${base}/api/admin/me`, { credentials: 'include' })
    if (res.status === 401) return null
    if (!res.ok) throw new Error(`me failed: ${res.status}`)
    return (await res.json()) as SessionUser
  },
  login: (email: string, password: string) =>
    postJSON<SessionUser>('/api/admin/login', { email, password }),
  setup: (email: string, password: string) =>
    postJSON<SessionUser>('/api/admin/setup', { email, password }),
  logout: () =>
    fetch(`${base}/api/admin/logout`, { method: 'POST', credentials: 'include' }).then(() => {}),

  // ---- admin config --------------------------------------------------------
  adminConfig: () => getJSON<{ items: AdminConfigItem[] }>('/api/admin/config').then((r) => r.items),
  saveConfig: (key: string, value: string) =>
    postJSON<{ ok: boolean }>('/api/admin/config', { key, value }),

  listMessages: (opts: { folder?: Folder; q?: string } = {}) => {
    const p = new URLSearchParams()
    if (opts.folder) p.set('folder', opts.folder)
    if (opts.q) p.set('q', opts.q)
    const qs = p.toString()
    return getJSON<{ messages: MessageRow[] }>(`/api/messages${qs ? `?${qs}` : ''}`).then((r) => r.messages)
  },

  getMessage: (id: string) => getJSON<{ message: MessageRow }>(`/api/messages/${id}`).then((r) => r.message),

  updateFlags: async (id: string, flags: MessageFlags): Promise<MessageRow> => {
    const res = await fetch(`${base}/api/messages/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(flags),
    })
    if (!res.ok) throw new Error(`patch failed: ${res.status}`)
    return (await res.json() as { message: MessageRow }).message
  },

  send: async (body: SendBody): Promise<{ id: string; status: string }> => {
    const res = await fetch(`${base}/api/send`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(e.error ?? `send failed: ${res.status}`)
    }
    return (await res.json()) as { id: string; status: string }
  },
}
