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
  name?: string | null
  avatarUrl?: string | null
}

export interface SenderAccount {
  id: string
  address: string
  label: string | null
  created_by: string | null
  created_at: number
}

export interface TeamUser {
  id: string
  email: string
  role: 'admin' | 'user'
  status: 'active' | 'pending' | 'invited'
  provider: 'password' | 'google'
  name: string | null
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
  from?: string
  text?: string
  html?: string
  inReplyTo?: string
}

export interface AppConfig {
  sending: boolean
  push: boolean
  needsSetup: boolean
  oauth: boolean
  googleClientId: string
  appName: string
  logoUrl: string
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
  signup: (email: string, password: string) =>
    postJSON<{ status: string; email: string }>('/api/admin/signup', { email, password }),
  verify: (email: string, code: string) =>
    postJSON<SessionUser>('/api/admin/verify', { email, code }),
  resend: (email: string) => postJSON<{ ok: boolean }>('/api/admin/resend', { email }),
  loginWithGoogle: (code: string, redirectUri: string) =>
    postJSON<SessionUser>('/api/auth/google', { code, redirectUri }),
  logout: () =>
    fetch(`${base}/api/admin/logout`, { method: 'POST', credentials: 'include' }).then(() => {}),
  deleteAccount: () => postJSON<{ ok: boolean }>('/api/admin/account/delete', {}),

  // ---- admin config --------------------------------------------------------
  adminConfig: () => getJSON<{ items: AdminConfigItem[] }>('/api/admin/config').then((r) => r.items),
  saveConfig: (key: string, value: string) =>
    postJSON<{ ok: boolean }>('/api/admin/config', { key, value }),

  // ---- team members (admin) ------------------------------------------------
  users: () => getJSON<{ users: TeamUser[] }>('/api/admin/users').then((r) => r.users),
  inviteUser: (email: string, role: 'admin' | 'user') =>
    postJSON<TeamUser>('/api/admin/users', { email, role }),
  removeUser: async (id: string): Promise<void> => {
    const res = await fetch(`${base}/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'remove failed')
  },

  listMessages: (opts: { folder?: Folder; q?: string } = {}) => {
    const p = new URLSearchParams()
    if (opts.folder) p.set('folder', opts.folder)
    if (opts.q) p.set('q', opts.q)
    const qs = p.toString()
    return getJSON<{ messages: MessageRow[] }>(`/api/messages${qs ? `?${qs}` : ''}`).then((r) => r.messages)
  },

  getMessage: (id: string) => getJSON<{ message: MessageRow }>(`/api/messages/${id}`).then((r) => r.message),

  identities: () => getJSON<{ identities: string[]; default: string }>('/api/identities'),

  // ---- provisioned send-as addresses ---------------------------------------
  senders: () => getJSON<{ senders: SenderAccount[] }>('/api/senders').then((r) => r.senders),
  createSender: (address: string, label?: string) =>
    postJSON<SenderAccount>('/api/senders', { address, label }),
  removeSender: async (id: string): Promise<void> => {
    const res = await fetch(`${base}/api/senders/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) throw new Error('remove failed')
  },

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
