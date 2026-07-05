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

async function putJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
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

async function patchJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
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

async function del(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${base}${path}`, {
    method: 'DELETE',
    credentials: 'include',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'request failed')
}

export interface AccessAddress { id: string; address: string; label: string | null; created_at: number }
export interface AccessTeam { id: string; name: string; created_at: number }
export interface AccessView {
  addresses: AccessAddress[]
  teams: AccessTeam[]
  members: { team_id: string; user_id: string; role: string }[]
  grants: { address_id: string; user_id: string | null; team_id: string | null }[]
  users: { id: string; email: string; role: 'admin' | 'user' }[]
}
export type GrantSubject = { userId: string } | { teamId: string }

export interface MyTeam { id: string; name: string; created_at: number; myRole: string }
export interface TeamsView {
  teams: MyTeam[]
  members: { team_id: string; user_id: string; role: string }[]
  users: { id: string; email: string }[]
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
  provider: 'password' | 'google' | 'github'
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

export interface EncryptionStatus {
  enabled: boolean
  source: 'env' | 'saved' | 'unset'
  fingerprint?: string
  alg?: string
  invalid?: boolean
  error?: string
}

export interface AppConfig {
  sending: boolean
  push: boolean
  needsSetup: boolean
  oauth: boolean
  googleClientId: string
  githubClientId: string
  appName: string
  logoUrl: string
  openRegistration: boolean
  assistant: boolean
  assistantProvider: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface Todo {
  id: string
  message_id: string
  user_id: string
  text: string
  done: number
  position: number
  source: string
  created_at: number
  updated_at: number
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
  loginWithGitHub: (code: string, redirectUri: string) =>
    postJSON<SessionUser>('/api/auth/github', { code, redirectUri }),
  logout: () =>
    fetch(`${base}/api/admin/logout`, { method: 'POST', credentials: 'include' }).then(() => {}),
  deleteAccount: () => postJSON<{ ok: boolean }>('/api/admin/account/delete', {}),

  // ---- admin config --------------------------------------------------------
  adminConfig: () => getJSON<{ items: AdminConfigItem[] }>('/api/admin/config').then((r) => r.items),

  // ---- at-rest encryption --------------------------------------------------
  encryption: () => getJSON<EncryptionStatus>('/api/admin/encryption'),
  setEncryption: (publicKey: string) =>
    putJSON<{ enabled: true; fingerprint: string; alg: string }>('/api/admin/encryption', { publicKey }),
  disableEncryption: () => del('/api/admin/encryption'),
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

  // ---- access: addresses, teams, grants (admin) ----------------------------
  access: () => getJSON<AccessView>('/api/admin/access'),
  provisionAddress: (address: string, label?: string) =>
    postJSON<AccessAddress>('/api/admin/addresses', { address, label }),
  removeAddress: (id: string) => del(`/api/admin/addresses/${id}`),
  createAccessTeam: (name: string) => postJSON<AccessTeam>('/api/admin/teams', { name }),
  removeTeam: (id: string) => del(`/api/admin/teams/${id}`),
  addTeamMember: (teamId: string, userId: string) =>
    postJSON<{ ok: boolean }>(`/api/admin/teams/${teamId}/members`, { userId }),
  removeTeamMember: (teamId: string, userId: string) => del(`/api/admin/teams/${teamId}/members/${userId}`),
  grant: (addressId: string, who: GrantSubject) => postJSON<{ ok: boolean }>('/api/admin/grants', { addressId, ...who }),
  revoke: (addressId: string, who: GrantSubject) => del('/api/admin/grants', { addressId, ...who }),

  // ---- team-admin (a member managing their own team) -----------------------
  teams: () => getJSON<TeamsView>('/api/teams'),
  teamAddMember: (teamId: string, userId: string) =>
    postJSON<{ ok: boolean }>(`/api/teams/${teamId}/members`, { userId }),
  teamRemoveMember: (teamId: string, userId: string) => del(`/api/teams/${teamId}/members/${userId}`),

  listMessages: (opts: { folder?: Folder; q?: string } = {}) => {
    const p = new URLSearchParams()
    if (opts.folder) p.set('folder', opts.folder)
    if (opts.q) p.set('q', opts.q)
    const qs = p.toString()
    return getJSON<{ messages: MessageRow[] }>(`/api/messages${qs ? `?${qs}` : ''}`).then((r) => r.messages)
  },

  getMessage: (id: string) => getJSON<{ message: MessageRow }>(`/api/messages/${id}`).then((r) => r.message),

  // The full conversation (inbound + our sent replies), oldest first.
  getThread: (id: string) =>
    getJSON<{ messages: MessageRow[] }>(`/api/messages/${id}/thread`).then((r) => r.messages),

  identities: () => getJSON<{ identities: string[]; default: string }>('/api/identities'),

  // ---- registration / claim a personal mailbox -----------------------------
  registrationStatus: () =>
    getJSON<{ openRegistration: boolean; hasMailbox: boolean; canClaim: boolean }>('/api/registration/status'),
  checkAddress: (address: string) =>
    getJSON<{ available: boolean; reason?: string }>(`/api/registration/check?address=${encodeURIComponent(address)}`),
  claimMailbox: (address: string) => postJSON<{ address: string }>('/api/registration/claim', { address }),

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

  // ---- AI assistant (gated; 503 when no provider is configured) ------------
  aiSummary: (messageId: string) =>
    postJSON<{ summary: string }>('/api/ai/summary', { messageId }).then((r) => r.summary),
  aiSmartReplies: (messageId: string) =>
    postJSON<{ replies: string[] }>('/api/ai/smart-replies', { messageId }).then((r) => r.replies),
  aiAssistant: (messageId: string | undefined, messages: ChatTurn[]) =>
    postJSON<{ reply: string }>('/api/ai/assistant', { messageId, messages }).then((r) => r.reply),

  // ---- Persisted to-dos (AI-seeded, user-owned) ----------------------------
  listTodos: (messageId: string) =>
    getJSON<{ todos: Todo[] }>(`/api/todos?messageId=${encodeURIComponent(messageId)}`).then((r) => r.todos),
  addTodo: (messageId: string, text: string) =>
    postJSON<{ todo: Todo }>('/api/todos', { messageId, text }).then((r) => r.todo),
  updateTodo: (id: string, patch: { text?: string; done?: boolean }) =>
    patchJSON<{ todo: Todo }>(`/api/todos/${id}`, patch).then((r) => r.todo),
  deleteTodo: (id: string) => del(`/api/todos/${id}`),

  send: async (body: SendBody): Promise<{ id: string; status: string; message?: MessageRow }> => {
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
    return (await res.json()) as { id: string; status: string; message?: MessageRow }
  },

  // Thread-wide flags — files/stars the whole conversation from the collapsed list.
  updateThreadFlags: async (threadId: string, flags: MessageFlags): Promise<void> => {
    const res = await fetch(`${base}/api/threads/${threadId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(flags),
    })
    if (!res.ok) throw new Error(`thread patch failed: ${res.status}`)
  },
}
