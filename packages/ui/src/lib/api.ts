import type { MessageRow } from '@mailkite/core'

const base: string =
  (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? ''

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return (await res.json()) as T
}

export interface SendBody {
  to: string
  subject: string
  text?: string
  html?: string
  inReplyTo?: string
}

export const api = {
  listMessages: () => getJSON<{ messages: MessageRow[] }>('/api/messages').then((r) => r.messages),
  getMessage: (id: string) => getJSON<{ message: MessageRow }>(`/api/messages/${id}`).then((r) => r.message),
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
