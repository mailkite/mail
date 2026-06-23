import type { SqlDriver } from './ports'

// Minimal structural view of the D1 binding — just the surface this driver
// uses. Declaring it here (instead of depending on @cloudflare/workers-types)
// keeps @mailkite/core dependency-free and isomorphic; the Workers app passes
// its real `env.DB` binding, which is structurally compatible.
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  run(): Promise<unknown>
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
}
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
}

/**
 * Cloudflare D1 driver — the own store for the hosted/Workers target. Same
 * `SqlDriver` contract as the Node SqliteDriver, so MailRepo is unchanged.
 *
 * Schema migrations on D1 are applied ahead of time via `wrangler d1 migrations
 * apply` (see apps/web/migrations), so the Worker never runs `migrate()` in the
 * request path. `exec()` is still implemented for tests and first-boot use.
 */
export class D1Driver implements SqlDriver {
  constructor(private readonly db: D1DatabaseLike) {}

  async exec(sql: string): Promise<void> {
    // Strip full-line `--` comments first: a comment may itself contain a `;`
    // (e.g. "env-first; this is the DB fallback"), which would otherwise shred
    // the split. After that the schema has no in-statement semicolons.
    const statements = sql
      .replace(/^[ \t]*--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) {
      await this.db.prepare(statement).run()
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.db.prepare(sql).bind(...params).run()
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const row = await this.db.prepare(sql).bind(...params).first<T>()
    return row ?? undefined
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { results } = await this.db.prepare(sql).bind(...params).all<T>()
    return results
  }
}
