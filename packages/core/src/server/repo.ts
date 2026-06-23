import type { WebhookPayload, MessageRow } from '../types'
import { mapWebhookToMessage } from '../webhook/map'
import type { SqlDriver, BlobStore } from './ports'
import { SCHEMA_SQL } from './schema'

export interface IngestOptions {
  now: number
  /** Download an attachment's bytes from its (short-lived, signed) source URL. */
  fetchAttachment: (url: string) => Promise<Uint8Array>
}

/** The own-store repository: ingest webhooks, read messages. Backend-only. */
export class MailRepo {
  constructor(
    private readonly sql: SqlDriver,
    private readonly blobs: BlobStore,
  ) {}

  async migrate(): Promise<void> {
    await this.sql.exec(SCHEMA_SQL)
  }

  /**
   * Idempotently store an `email.received` webhook. Returns `{ stored: false }`
   * if this message id was already ingested (a re-delivery).
   */
  async ingestWebhookMessage(
    payload: WebhookPayload,
    opts: IngestOptions,
  ): Promise<{ stored: boolean }> {
    const seen = await this.sql.get<{ id: string }>(
      'SELECT id FROM ingest_log WHERE id = ?',
      [payload.id],
    )
    if (seen) return { stored: false }

    const m = mapWebhookToMessage(payload, opts.now)

    await this.sql.run(
      `INSERT OR IGNORE INTO threads (id, subject, last_received_at, message_count)
       VALUES (?, ?, ?, 0)`,
      [m.thread_id, m.subject, opts.now],
    )
    await this.sql.run(
      `INSERT OR IGNORE INTO messages
         (id, thread_id, direction, from_addr, to_addr, subject, text_body, html_body,
          spf, dkim, dmarc, spam, unread, received_at)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        m.id, m.thread_id, m.from_addr, m.to_addr, m.subject, m.text_body, m.html_body,
        m.spf, m.dkim, m.dmarc, m.spam, m.received_at,
      ],
    )
    await this.sql.run(
      `UPDATE threads
         SET last_received_at = ?,
             message_count    = message_count + 1,
             subject          = COALESCE(subject, ?)
       WHERE id = ?`,
      [opts.now, m.subject, m.thread_id],
    )

    // Fetch-and-rehost attachments at ingest — the signed source URL expires (~7d).
    const atts = payload.attachments ?? []
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i]
      const key = `att/${payload.id}/${i}`
      const bytes = await opts.fetchAttachment(att.url)
      await this.blobs.put(key, bytes, att.contentType ?? undefined)
      await this.sql.run(
        `INSERT OR IGNORE INTO attachments
           (id, message_id, idx, filename, content_type, size, blob_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [att.id, payload.id, i, att.filename, att.contentType, att.size, key],
      )
    }

    await this.sql.run(
      'INSERT INTO ingest_log (id, received_at) VALUES (?, ?)',
      [payload.id, opts.now],
    )
    return { stored: true }
  }

  async listMessages(limit = 50): Promise<MessageRow[]> {
    return this.sql.all<MessageRow>(
      'SELECT * FROM messages ORDER BY received_at DESC LIMIT ?',
      [limit],
    )
  }

  async getMessage(id: string): Promise<MessageRow | undefined> {
    return this.sql.get<MessageRow>('SELECT * FROM messages WHERE id = ?', [id])
  }
}
