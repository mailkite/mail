import type {
  WebhookPayload, MessageRow, MessageFlags, ListOptions, UserRow, UserStatus, Role, SenderAccountRow,
  Actor, AddressRow, TeamRow,
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
        m.id, m.thread_id, m.from_addr, m.to_addr, m.subject, m.text_body, m.html_body,
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
        `INSERT OR IGNORE INTO attachments (id, message_id, idx, filename, content_type, size, blob_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [att.id, payload.id, i, att.filename, att.contentType, att.size, key],
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
    return this.sql.all<MessageRow>(
      `SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY received_at DESC LIMIT ?`,
      params,
    )
  }

  async getMessage(actor: Actor, id: string): Promise<MessageRow | undefined> {
    const scope = this.scopePredicate(actor)
    // Per-object scope: never "load by id then check" (closes IDOR).
    return this.sql.get<MessageRow>(`SELECT * FROM messages WHERE id = ? AND ${scope.sql}`, [id, ...scope.params])
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
      `INSERT INTO users (id, email, password_hash, role, created_at, name, provider, google_sub, status, invited_by, avatar_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        u.id, u.email, u.password_hash, u.role, u.created_at,
        u.name ?? null, u.provider ?? 'password', u.google_sub ?? null,
        u.status ?? 'active', u.invited_by ?? null, u.avatar_url ?? null,
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
