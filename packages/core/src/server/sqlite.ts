import Database from 'better-sqlite3'
import type { SqlDriver } from './ports'

/** Node SQLite driver (better-sqlite3). The own store for self-hosted installs. */
export class SqliteDriver implements SqlDriver {
  private readonly db: Database.Database

  constructor(path = ':memory:') {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]))
  }

  async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined
  }

  async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[]
  }
}
