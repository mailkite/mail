import type { MessageRow } from '@mailkite/core'

const base: string = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? ''

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return (await res.json()) as T
}

export const api = {
  listMessages: () => getJSON<{ messages: MessageRow[] }>('/api/messages').then((r) => r.messages),
  getMessage: (id: string) => getJSON<{ message: MessageRow }>(`/api/messages/${id}`).then((r) => r.message),
}
