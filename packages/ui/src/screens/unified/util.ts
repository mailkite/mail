import type { MessageRow } from '@mailkite/core'
import { parseEnvelope } from '../../lib/envelope'

/** "sarah@acme.com" → "Sarah", "Sarah Chen <s@x>" → "Sarah Chen". */
export function senderName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</)
  if (m) return m[1].trim()
  const local = addr.split('@')[0] ?? addr
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** Relative-ish timestamp: today → "9:02", this week → "Mon", else "Jun 3". */
export function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts < 1e12 ? ts * 1000 : ts) // tolerate seconds or ms
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86_400_000
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Plain-text preview of a message body. Encrypted bodies show a placeholder, not the envelope. */
export function snippet(m: Pick<MessageRow, 'text_body' | 'html_body'>, max = 140): string {
  if (parseEnvelope(m.text_body) || parseEnvelope(m.html_body)) return '🔒 Encrypted message'
  const raw = m.text_body || (m.html_body ? m.html_body.replace(/<[^>]*>/g, ' ') : '')
  const clean = raw.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}
