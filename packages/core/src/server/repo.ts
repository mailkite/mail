import type {
  WebhookPayload, MessageRow, MessageFlags, ListOptions, UserRow, UserStatus, Role, SenderAccountRow,
  Actor, AddressRow, TeamRow, TodoRow, AttachmentMeta,
} from '../types'
import { mapWebhookToMessage } from '../webhook/map'
import type { SqlDriver, BlobStore } from './ports'
import { SCHEMA_SQL } from './schema'

export interface IngestOptions {
  now: number
  /** Download an attachment's bytes from its (short-lived, signed) source URL. */
  fetchAttachment: (url: string) => Promise<Uint8Array>
  /** 'open' (default): auto-create the receiving address. 'provisioned': only
   *  store mail to addresses the owner has provisioned; drop the rest. */
  addressMode?: 'open' | 'provisioned'
  /** At-rest encryption (opt-in): when set, each body is encrypted to the account's
   *  public key before it's written to the own store, so only the private-key holder
   *  can read it. Subject/from/to stay plaintext (list views, dedupe). Null/empty
   *  bodies pass through. Detection is envelope-based — no schema column needed.
   *  See packages/core/src/server/encryption.ts and docs/architecture.md §1.1. */
  encryptBody?: (text: string | null | undefined) => Promise<string | null>
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
    let addressId: string | null
    if (opts.addressMode === 'provisioned') {
      const addr = m.to_addr ? await this.getAddressByName(m.to_addr) : undefined
      if (!addr) return { stored: false } // drop mail to an unprovisioned address
      addressId = addr.id
    } else {
      addressId = await this.resolveAddressId(m.to_addr, opts.now) // open: auto-create
    }

    // Encrypt the bodies at rest when a key is configured (subject stays plaintext for listing).
    const textBody = opts.encryptBody ? await opts.encryptBody(m.text_body) : m.text_body
    const htmlBody = opts.encryptBody ? await opts.encryptBody(m.html_body) : m.html_body

    await this.sql.run(
      `INSERT OR IGNORE INTO threads (id, subject, last_received_at, message_count) VALUES (?, ?, ?, 0)`,
      [m.thread_id, m.subject, opts.now],
    )
    await this.sql.run(
      `INSERT OR IGNORE INTO messages
         (id, thread_id, direction, from_addr, to_addr, subject, text_body, html_body,
          spf, dkim, dmarc, spam, unread, starred, archived, received_at, address_id)
       VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
      [
        m.id, m.thread_id, m.from_addr, m.to_addr, m.subject, textBody, htmlBody,
        m.spf, m.dkim, m.dmarc, m.spam, m.received_at, addressId,
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
        `INSERT OR IGNORE INTO attachments (id, message_id, idx, filename, content_type, size, blob_key, content_id, disposition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [att.id, payload.id, i, att.filename, att.contentType, att.size, key, att.contentId ?? null, att.disposition ?? null],
      )
    }

    await this.sql.run('INSERT INTO ingest_log (id, received_at) VALUES (?, ?)', [payload.id, opts.now])
    return { stored: true }
  }

  // ---- ACL choke point (docs/acl.md) ---------------------------------------
  /** The RLS-we-don't-have: turns an Actor into a SQL predicate + bindings.
   *  Admin ⇒ every address (1=1). Member ⇒ only granted addresses (direct or via
   *  a team). Deny-by-default: no grant ⇒ no rows. `addressCol` is an internal
   *  constant (never user input). */
  private scopePredicate(actor: Actor, addressCol = 'messages.address_id'): { sql: string; params: unknown[] } {
    if (actor.isAdmin) return { sql: '1=1', params: [] }
    return {
      sql: `EXISTS (SELECT 1 FROM address_grants g LEFT JOIN team_members tm ON tm.team_id = g.team_id
            WHERE g.address_id = ${addressCol} AND (g.user_id = ? OR tm.user_id = ?))`,
      params: [actor.userId, actor.userId],
    }
  }

  async listMessages(actor: Actor, opts: ListOptions = {}): Promise<MessageRow[]> {
    const scope = this.scopePredicate(actor)
    const where: string[] = [scope.sql]
    const params: unknown[] = [...scope.params]
    if (opts.folder === 'archive') where.push('archived = 1')
    else if (opts.folder === 'starred') where.push('starred = 1')
    else where.push('archived = 0')

    if (opts.q) {
      where.push('(subject LIKE ? OR from_addr LIKE ? OR text_body LIKE ?)')
      const term = `%${opts.q}%`
      params.push(term, term, term)
    }
    params.push(opts.limit ?? 100)
    // Collapse to one row per thread: the newest matching message represents the
    // conversation and `thread_count` is how many messages match the same filter
    // (so inbound + our sent replies count together — see storeOutbound). SQLite
    // quirk we lean on: when a SELECT has a bare `*` alongside MAX(), the bare
    // columns are taken from the row holding that max — i.e. `*` is the newest
    // message. `_mx` is that max timestamp; we sort by it and then drop it.
    const rows = await this.sql.all<MessageRow & { _mx: number }>(
      `SELECT *, COUNT(*) AS thread_count, MAX(received_at) AS _mx
         FROM messages WHERE ${where.join(' AND ')}
         GROUP BY thread_id
         ORDER BY _mx DESC
         LIMIT ?`,
      params,
    )
    return rows.map(({ _mx, ...m }) => m)
  }

  async getMessage(actor: Actor, id: string): Promise<MessageRow | undefined> {
    const scope = this.scopePredicate(actor)
    // Per-object scope: never "load by id then check" (closes IDOR).
    return this.sql.get<MessageRow>(`SELECT * FROM messages WHERE id = ? AND ${scope.sql}`, [id, ...scope.params])
  }

  /** Every message in `id`'s thread, oldest→newest, for the conversation view.
   *  Scopes twice: the anchor is authorized through the Actor first, then the
   *  thread query re-applies the predicate (a thread's messages share the same
   *  mailbox, so an authorized anchor implies an authorized thread). */
  async getThread(actor: Actor, id: string): Promise<MessageRow[]> {
    const anchor = await this.getMessage(actor, id)
    if (!anchor) return []
    const scope = this.scopePredicate(actor)
    return this.sql.all<MessageRow>(
      `SELECT * FROM messages WHERE thread_id = ? AND ${scope.sql} ORDER BY received_at ASC`,
      [anchor.thread_id, ...scope.params],
    )
  }

  /** Attachment metadata for a set of (already-authorized) messages, grouped by message id.
   *  Callers pass ids from scoped message reads, so no extra ACL is needed here. The `url` is a
   *  relative, ACL-scoped byte route the browser fetches same-origin. */
  async attachmentsForMessages(messageIds: string[]): Promise<Map<string, AttachmentMeta[]>> {
    const map = new Map<string, AttachmentMeta[]>()
    if (messageIds.length === 0) return map
    const placeholders = messageIds.map(() => '?').join(',')
    const rows = await this.sql.all<{
      id: string; message_id: string; idx: number; filename: string | null
      content_type: string | null; size: number; content_id: string | null; disposition: string | null
    }>(
      `SELECT id, message_id, idx, filename, content_type, size, content_id, disposition
         FROM attachments WHERE message_id IN (${placeholders}) ORDER BY message_id, idx`,
      messageIds,
    )
    for (const r of rows) {
      const list = map.get(r.message_id) ?? []
      list.push({
        id: r.id, idx: r.idx, filename: r.filename, contentType: r.content_type,
        size: r.size, contentId: r.content_id, disposition: r.disposition,
        url: `/api/messages/${encodeURIComponent(r.message_id)}/attachments/${r.idx}`,
      })
      map.set(r.message_id, list)
    }
    return map
  }

  /** The bytes of one attachment, ACL-scoped: the parent message is resolved through the Actor
   *  first (closes IDOR), then the part is looked up by (message, idx) and read from the blob store. */
  async getAttachmentBlob(
    actor: Actor,
    messageId: string,
    idx: number,
  ): Promise<{ bytes: Uint8Array; contentType: string | null; filename: string | null } | undefined> {
    const msg = await this.getMessage(actor, messageId)
    if (!msg) return undefined
    const row = await this.sql.get<{ blob_key: string; content_type: string | null; filename: string | null }>(
      `SELECT blob_key, content_type, filename FROM attachments WHERE message_id = ? AND idx = ?`,
      [messageId, idx],
    )
    if (!row) return undefined
    const bytes = await this.blobs.get(row.blob_key)
    if (!bytes) return undefined
    return { bytes, contentType: row.content_type, filename: row.filename }
  }

  /** Persist a message we sent (a reply, or a new thread) into the own store so
   *  it threads alongside received mail. The thread + ACL address are inherited
   *  from the message being replied to; a bare compose starts its own thread and
   *  anchors on the sending address. Mirrors ingest's thread bookkeeping. */
  async storeOutbound(
    actor: Actor,
    input: {
      id: string
      inReplyTo?: string
      from: string
      to: string
      subject: string | null
      text?: string | null
      html?: string | null
      now: number
      encryptBody?: (t: string | null | undefined) => Promise<string | null>
    },
  ): Promise<MessageRow | undefined> {
    let threadId = input.id
    let addressId: string | null = null
    let subject = input.subject
    if (input.inReplyTo) {
      const parent = await this.getMessage(actor, input.inReplyTo)
      if (parent) {
        threadId = parent.thread_id
        addressId = (parent as unknown as { address_id: string | null }).address_id ?? null
        subject = subject ?? parent.subject
      }
    }
    if (addressId === null) {
      const fromAddr = (input.from.match(/<([^>]+)>/)?.[1] ?? input.from).trim()
      addressId = (await this.getAddressByName(fromAddr))?.id ?? null
    }

    const textBody = input.encryptBody ? await input.encryptBody(input.text) : (input.text ?? null)
    const htmlBody = input.encryptBody ? await input.encryptBody(input.html) : (input.html ?? null)

    await this.sql.run(
      `INSERT OR IGNORE INTO threads (id, subject, last_received_at, message_count) VALUES (?, ?, ?, 0)`,
      [threadId, subject, input.now],
    )
    await this.sql.run(
      `INSERT OR IGNORE INTO messages
         (id, thread_id, direction, from_addr, to_addr, subject, text_body, html_body,
          spf, dkim, dmarc, spam, unread, starred, archived, received_at, address_id)
       VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, ?, ?)`,
      [input.id, threadId, input.from, input.to, subject, textBody, htmlBody, input.now, addressId],
    )
    await this.sql.run(
      `UPDATE threads SET last_received_at = ?, message_count = message_count + 1 WHERE id = ?`,
      [input.now, threadId],
    )
    return this.getMessage(actor, input.id)
  }

  // ---- Provisioned send-as addresses (team-wide, no ACL) -------------------
  async listSenderAccounts(): Promise<SenderAccountRow[]> {
    return this.sql.all<SenderAccountRow>('SELECT * FROM sender_accounts ORDER BY created_at ASC')
  }
  async getSenderByAddress(address: string): Promise<SenderAccountRow | undefined> {
    return this.sql.get<SenderAccountRow>('SELECT * FROM sender_accounts WHERE address = ?', [address])
  }
  async createSenderAccount(s: SenderAccountRow): Promise<void> {
    await this.sql.run(
      'INSERT INTO sender_accounts (id, address, label, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      [s.id, s.address, s.label, s.created_by, s.created_at],
    )
  }
  async deleteSenderAccount(id: string): Promise<void> {
    await this.sql.run('DELETE FROM sender_accounts WHERE id = ?', [id])
  }

  /** Addresses the actor may send as — admin sees all; a member only the
   *  addresses granted to them (directly or via a team). */
  async listIdentities(actor: Actor): Promise<string[]> {
    if (actor.isAdmin) {
      const rows = await this.sql.all<{ address: string }>('SELECT address FROM addresses ORDER BY address')
      return rows.map((r) => r.address)
    }
    const scope = this.scopePredicate(actor, 'a.id')
    const rows = await this.sql.all<{ address: string }>(
      `SELECT a.address FROM addresses a WHERE ${scope.sql} ORDER BY a.address`,
      scope.params,
    )
    return rows.map((r) => r.address)
  }

  /** Toggle read/starred/archived flags. Ignores keys that aren't provided. */
  async updateFlags(actor: Actor, id: string, flags: MessageFlags): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    for (const k of FLAG_COLUMNS) {
      if (flags[k] !== undefined) {
        sets.push(`${k} = ?`)
        params.push(flags[k] ? 1 : 0)
      }
    }
    if (sets.length === 0) return
    // Write-path scope: an out-of-scope id updates 0 rows.
    const scope = this.scopePredicate(actor)
    params.push(id, ...scope.params)
    await this.sql.run(`UPDATE messages SET ${sets.join(', ')} WHERE id = ? AND ${scope.sql}`, params)
  }

  /** Apply flags to every message in a thread — used when archiving from the
   *  collapsed list, so filing a conversation files all of it (not just the
   *  representative message). Scoped like updateFlags. */
  async updateThreadFlags(actor: Actor, threadId: string, flags: MessageFlags): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    for (const k of FLAG_COLUMNS) {
      if (flags[k] !== undefined) {
        sets.push(`${k} = ?`)
        params.push(flags[k] ? 1 : 0)
      }
    }
    if (sets.length === 0) return
    const scope = this.scopePredicate(actor)
    params.push(threadId, ...scope.params)
    await this.sql.run(`UPDATE messages SET ${sets.join(', ')} WHERE thread_id = ? AND ${scope.sql}`, params)
  }

  // ---- ACL: addresses, teams, grants (docs/acl.md) -------------------------
  /** Upsert an address, returning its id — used by ingest to auto-create the
   *  receiving address as the ACL anchor. */
  private async resolveAddressId(address: string, now: number): Promise<string | null> {
    if (!address) return null
    const existing = await this.sql.get<{ id: string }>('SELECT id FROM addresses WHERE address = ?', [address])
    if (existing) return existing.id
    const id = `adr_${crypto.randomUUID()}`
    await this.sql.run('INSERT OR IGNORE INTO addresses (id, address, created_at) VALUES (?, ?, ?)', [id, address, now])
    const row = await this.sql.get<{ id: string }>('SELECT id FROM addresses WHERE address = ?', [address])
    return row?.id ?? id
  }

  async listAddresses(): Promise<AddressRow[]> {
    return this.sql.all<AddressRow>('SELECT * FROM addresses ORDER BY address')
  }
  async getAddressByName(address: string): Promise<AddressRow | undefined> {
    return this.sql.get<AddressRow>('SELECT * FROM addresses WHERE address = ?', [address])
  }
  async createAddress(a: AddressRow): Promise<void> {
    await this.sql.run('INSERT OR IGNORE INTO addresses (id, address, label, created_at) VALUES (?, ?, ?, ?)',
      [a.id, a.address, a.label, a.created_at])
  }
  async deleteAddress(id: string): Promise<void> {
    await this.sql.run('DELETE FROM address_grants WHERE address_id = ?', [id])
    await this.sql.run('DELETE FROM addresses WHERE id = ?', [id])
  }

  async listTeams(): Promise<TeamRow[]> {
    return this.sql.all<TeamRow>('SELECT * FROM teams ORDER BY name')
  }
  async createTeam(t: TeamRow): Promise<void> {
    await this.sql.run('INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at])
  }
  async deleteTeam(id: string): Promise<void> {
    await this.sql.run('DELETE FROM team_members WHERE team_id = ?', [id])
    await this.sql.run('DELETE FROM address_grants WHERE team_id = ?', [id])
    await this.sql.run('DELETE FROM teams WHERE id = ?', [id])
  }
  async addTeamMember(teamId: string, userId: string, role = 'member'): Promise<void> {
    await this.sql.run('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [teamId, userId, role])
  }
  async removeTeamMember(teamId: string, userId: string): Promise<void> {
    await this.sql.run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId])
  }
  async listTeamMembers(): Promise<{ team_id: string; user_id: string; role: string }[]> {
    return this.sql.all('SELECT team_id, user_id, role FROM team_members')
  }
  async teamsForUser(userId: string): Promise<{ team_id: string; role: string }[]> {
    return this.sql.all('SELECT team_id, role FROM team_members WHERE user_id = ?', [userId])
  }
  /** True if the user is an admin of the given team (manages its membership). */
  async isTeamAdmin(teamId: string, userId: string): Promise<boolean> {
    const row = await this.sql.get<{ x: number }>(
      "SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'admin'",
      [teamId, userId],
    )
    return !!row
  }
  async listGrants(): Promise<{ address_id: string; user_id: string | null; team_id: string | null }[]> {
    return this.sql.all('SELECT address_id, user_id, team_id FROM address_grants')
  }

  async grantAddressToUser(addressId: string, userId: string, now: number): Promise<void> {
    await this.sql.run('INSERT OR IGNORE INTO address_grants (address_id, user_id, created_at) VALUES (?, ?, ?)', [addressId, userId, now])
  }
  async grantAddressToTeam(addressId: string, teamId: string, now: number): Promise<void> {
    await this.sql.run('INSERT OR IGNORE INTO address_grants (address_id, team_id, created_at) VALUES (?, ?, ?)', [addressId, teamId, now])
  }
  async revokeUserGrant(addressId: string, userId: string): Promise<void> {
    await this.sql.run('DELETE FROM address_grants WHERE address_id = ? AND user_id = ?', [addressId, userId])
  }
  async revokeTeamGrant(addressId: string, teamId: string): Promise<void> {
    await this.sql.run('DELETE FROM address_grants WHERE address_id = ? AND team_id = ?', [addressId, teamId])
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

  // ---- Assistant: AI cache + to-dos ----------------------------------------
  // Cache is content-derived (keyed by message + kind), so it's shared across users; the ROUTE
  // enforces ACL by loading the message through the Actor before it ever reads/writes here.

  async getAiCache(messageId: string, kind: string): Promise<{ content: string; model: string | null } | undefined> {
    return this.sql.get<{ content: string; model: string | null }>(
      'SELECT content, model FROM ai_cache WHERE message_id = ? AND kind = ?',
      [messageId, kind],
    )
  }

  async putAiCache(messageId: string, kind: string, content: string, model: string | null, now: number): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_cache (message_id, kind, content, model, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(message_id, kind) DO UPDATE SET content = excluded.content, model = excluded.model, created_at = excluded.created_at`,
      [messageId, kind, content, model, now],
    )
  }

  // To-dos are user-scoped: every read/write filters by user_id so one member never sees or edits
  // another's list, even for a shared mailbox.
  async listTodos(userId: string, messageId: string): Promise<TodoRow[]> {
    return this.sql.all<TodoRow>(
      'SELECT * FROM todos WHERE user_id = ? AND message_id = ? ORDER BY position ASC, created_at ASC',
      [userId, messageId],
    )
  }

  async createTodo(t: TodoRow): Promise<void> {
    await this.sql.run(
      `INSERT INTO todos (id, message_id, user_id, text, done, position, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.message_id, t.user_id, t.text, t.done, t.position, t.source, t.created_at, t.updated_at],
    )
  }

  async getTodo(userId: string, id: string): Promise<TodoRow | undefined> {
    return this.sql.get<TodoRow>('SELECT * FROM todos WHERE id = ? AND user_id = ?', [id, userId])
  }

  async updateTodo(userId: string, id: string, patch: { text?: string; done?: boolean }, now: number): Promise<TodoRow | undefined> {
    const sets: string[] = ['updated_at = ?']
    const params: unknown[] = [now]
    if (patch.text !== undefined) { sets.push('text = ?'); params.push(patch.text) }
    if (patch.done !== undefined) { sets.push('done = ?'); params.push(patch.done ? 1 : 0) }
    params.push(id, userId)
    await this.sql.run(`UPDATE todos SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, params)
    return this.getTodo(userId, id)
  }

  async deleteTodo(userId: string, id: string): Promise<void> {
    await this.sql.run('DELETE FROM todos WHERE id = ? AND user_id = ?', [id, userId])
  }

  /** The next free position at the end of a user's list for a message. */
  async nextTodoPosition(userId: string, messageId: string): Promise<number> {
    const row = await this.sql.get<{ n: number | null }>(
      'SELECT MAX(position) AS n FROM todos WHERE user_id = ? AND message_id = ?',
      [userId, messageId],
    )
    return (row?.n ?? -1) + 1
  }

  // ---- Users & roles -------------------------------------------------------

  async countUsers(): Promise<number> {
    const row = await this.sql.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    return row?.n ?? 0
  }

  async getUserByEmail(email: string): Promise<UserRow | undefined> {
    return this.sql.get<UserRow>('SELECT * FROM users WHERE email = ?', [email])
  }

  async listUsers(): Promise<UserRow[]> {
    return this.sql.all<UserRow>('SELECT * FROM users ORDER BY created_at ASC')
  }

  async getUserById(id: string): Promise<UserRow | undefined> {
    return this.sql.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
  }

  async deleteUser(id: string): Promise<void> {
    await this.sql.run('DELETE FROM users WHERE id = ?', [id])
  }

  async createUser(u: UserRow): Promise<void> {
    await this.sql.run(
      `INSERT INTO users (id, email, password_hash, role, created_at, name, provider, google_sub, status, invited_by, avatar_url, github_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        u.id, u.email, u.password_hash, u.role, u.created_at,
        u.name ?? null, u.provider ?? 'password', u.google_sub ?? null,
        u.status ?? 'active', u.invited_by ?? null, u.avatar_url ?? null, u.github_sub ?? null,
      ],
    )
  }

  async setUserStatus(email: string, status: UserStatus): Promise<void> {
    await this.sql.run('UPDATE users SET status = ? WHERE email = ?', [status, email])
  }

  async setUserPassword(email: string, passwordHash: string): Promise<void> {
    await this.sql.run('UPDATE users SET password_hash = ? WHERE email = ?', [passwordHash, email])
  }

  /** Create or activate a Google-authenticated user (no password). Returns the row. */
  async upsertGoogleUser(u: { email: string; sub: string; name: string | null; picture: string | null }): Promise<UserRow> {
    const existing = await this.getUserByEmail(u.email)
    if (existing) {
      await this.sql.run(
        `UPDATE users SET provider = 'google', google_sub = ?, name = COALESCE(name, ?),
         avatar_url = COALESCE(avatar_url, ?), status = 'active' WHERE email = ?`,
        [u.sub, u.name, u.picture, u.email],
      )
      return (await this.getUserByEmail(u.email))!
    }
    const role: Role = (await this.countUsers()) === 0 ? 'admin' : 'user'
    const row: UserRow = {
      id: `usr_${crypto.randomUUID()}`,
      email: u.email,
      password_hash: '',
      role,
      created_at: Date.now(),
      name: u.name,
      provider: 'google',
      google_sub: u.sub,
      status: 'active',
      avatar_url: u.picture,
    }
    await this.createUser(row)
    return row
  }

  /** Create or activate a GitHub-authenticated user (no password). Returns the row. */
  async upsertGitHubUser(u: { email: string; sub: string; name: string | null; picture: string | null }): Promise<UserRow> {
    const existing = await this.getUserByEmail(u.email)
    if (existing) {
      await this.sql.run(
        `UPDATE users SET provider = 'github', github_sub = ?, name = COALESCE(name, ?),
         avatar_url = COALESCE(avatar_url, ?), status = 'active' WHERE email = ?`,
        [u.sub, u.name, u.picture, u.email],
      )
      return (await this.getUserByEmail(u.email))!
    }
    const role: Role = (await this.countUsers()) === 0 ? 'admin' : 'user'
    const row: UserRow = {
      id: `usr_${crypto.randomUUID()}`,
      email: u.email,
      password_hash: '',
      role,
      created_at: Date.now(),
      name: u.name,
      provider: 'github',
      github_sub: u.sub,
      status: 'active',
      avatar_url: u.picture,
    }
    await this.createUser(row)
    return row
  }

  // ---- Email verification codes (OTP) --------------------------------------
  /** Store a fresh code for `email`, replacing any prior code. */
  async putEmailCode(email: string, codeHash: string, expiresAt: number, now: number): Promise<void> {
    await this.sql.run('DELETE FROM email_codes WHERE email = ?', [email])
    await this.sql.run(
      'INSERT INTO email_codes (email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
      [email, codeHash, expiresAt, now],
    )
  }

  /** True if a matching, unexpired code exists; only then consumes it (a wrong
   *  guess must not invalidate the valid code). */
  async consumeEmailCode(email: string, codeHash: string, now: number): Promise<boolean> {
    const row = await this.sql.get<{ email: string }>(
      'SELECT email FROM email_codes WHERE email = ? AND code_hash = ? AND expires_at > ?',
      [email, codeHash, now],
    )
    if (row) await this.sql.run('DELETE FROM email_codes WHERE email = ?', [email])
    return !!row
  }
}
