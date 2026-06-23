import type { WebhookPayload, MessageRow, MessageFlags, ListOptions, UserRow } from '../types'
import { mapWebhookToMessage } from '../webhook/map'
import type { SqlDriver, BlobStore } from './ports'
import { SCHEMA_SQL } from './schema'

export interface IngestOptions {
  now: number
  /** Download an attachment's bytes from its (short-lived, signed) source URL. */
  fetchAttachment: (url: string) => Promise<Uint8Array>
}

const FLAG_COLUMNS = ['unread', 'starred', 'archived'] as const

/** The own-store repository: ingest webhooks, read/organize messages. Backend-only. */
export class MailRepo {
  constructor(
    private readonly sql: SqlDriver,
    private readonly blobs: BlobStore,
  ) {}

  async migrate(): Promise<void> {
    await this.sql.exec(SCHEMA_SQL)
  }

  /** Idempotently store an `email.received` webhook (re-delivery → `{ stored: false }`). */
  async ingestWebhookMessage(
    payload: WebhookPayload,
    opts: IngestOptions,
  ): Promise<{ stored: boolean }> {
    const seen = await this.sql.get<{ id: string }>('SELECT id FROM ingest_log WHERE id = ?', [payload.id])
    if (seen) return { stored: false }

    const m = mapWebhookToMessage(payload, opts.now)

    await this.sql.run(
      `INSERT OR IGNORE INTO threads (id, subject, last_received_at, message_count) VALUES (?, ?, ?, 0)`,
      [m.thread_id, m.subject, opts.now],
    )
    await this.sql.run(
      `INSERT OR IGNORE INTO messages
         (id, thread_id, direction, from_addr, to_addr, subject, text_body, html_body,
          spf, dkim, dmarc, spam, unread, starred, archived, received_at)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)`,
      [
        m.id, m.thread_id, m.from_addr, m.to_addr, m.subject, m.text_body, m.html_body,
        m.spf, m.dkim, m.dmarc, m.spam, m.received_at,
      ],
    )
    await this.sql.run(
      `UPDATE threads SET last_received_at = ?, message_count = message_count + 1, subject = COALESCE(subject, ?) WHERE id = ?`,
      [opts.now, m.subject, m.thread_id],
    )

    const atts = payload.attachments ?? []
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i]
      const key = `att/${payload.id}/${i}`
      const bytes = await opts.fetchAttachment(att.url)
      await this.blobs.put(key, bytes, att.contentType ?? undefined)
      await this.sql.run(
        `INSERT OR IGNORE INTO attachments (id, message_id, idx, filename, content_type, size, blob_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [att.id, payload.id, i, att.filename, att.contentType, att.size, key],
      )
    }

    await this.sql.run('INSERT INTO ingest_log (id, received_at) VALUES (?, ?)', [payload.id, opts.now])
    return { stored: true }
  }

  async listMessages(opts: ListOptions = {}): Promise<MessageRow[]> {
    const where: string[] = []
    const params: unknown[] = []
    if (opts.folder === 'archive') where.push('archived = 1')
    else if (opts.folder === 'starred') where.push('starred = 1')
    else where.push('archived = 0')

    if (opts.q) {
      where.push('(subject LIKE ? OR from_addr LIKE ? OR text_body LIKE ?)')
      const term = `%${opts.q}%`
      params.push(term, term, term)
    }
    params.push(opts.limit ?? 100)
    return this.sql.all<MessageRow>(
      `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY received_at DESC LIMIT ?`,
      params,
    )
  }

  async getMessage(id: string): Promise<MessageRow | undefined> {
    return this.sql.get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id])
  }

  /** Toggle read/starred/archived flags. Ignores keys that aren't provided. */
  async updateFlags(id: string, flags: MessageFlags): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    for (const k of FLAG_COLUMNS) {
      if (flags[k] !== undefined) {
        sets.push(`${k} = ?`)
        params.push(flags[k] ? 1 : 0)
      }
    }
    if (sets.length === 0) return
    params.push(id)
    await this.sql.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  // ---- Settings (operator-saved config; env-first fallback) ----------------

  async getSetting(key: string): Promise<string | undefined> {
    const row = await this.sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.sql.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  }

  // ---- Users & roles -------------------------------------------------------

  async countUsers(): Promise<number> {
    const row = await this.sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    return row?.n ?? 0
  }

  async getUserByEmail(email: string): Promise<UserRow | undefined> {
    return this.sql.get<UserRow>('SELECT * FROM users WHERE email = ?', [email])
  }

  async createUser(u: UserRow): Promise<void> {
    await this.sql.run(
      'INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [u.id, u.email, u.password_hash, u.role, u.created_at],
    )
  }
}
