import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_SQL } from '@mailkite/core/server'
import { SqliteDriver } from '@mailkite/core/server/node'

// The Node target builds its schema from SCHEMA_SQL at runtime (MailRepo.migrate);
// the Workers/D1 target applies apps/web/migrations/*.sql ahead of deploy. They
// must produce the same database. We assert that by applying each to a scratch
// SQLite DB and comparing the resulting sqlite_master objects — robust to
// formatting and to migrations evolving beyond the initial CREATE.

const HERE = dirname(fileURLToPath(import.meta.url))

async function schemaObjects(apply: (d: SqliteDriver) => Promise<void>): Promise<string[]> {
  const d = new SqliteDriver(':memory:')
  await apply(d)
  const rows = await d.all<{ sql: string }>(
    'SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name',
  )
  // Normalize structurally: collapse whitespace and drop spaces around
  // punctuation so SQLite's ALTER-ADD-COLUMN reformatting (e.g. "NOT NULL ,")
  // compares equal to the hand-written SCHEMA_SQL.
  return rows
    .map((r) => r.sql.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim())
    .sort()
}

describe('D1 migrations ↔ SCHEMA_SQL', () => {
  it('applying migrations/ yields the same schema the Node target builds', async () => {
    const dir = resolve(HERE, '../migrations')
    const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    expect(migrations.length).toBeGreaterThan(0)
    const migrationSql = migrations.map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n')

    const fromMigrations = await schemaObjects((d) => d.exec(migrationSql))
    const fromSchema = await schemaObjects((d) => d.exec(SCHEMA_SQL))
    expect(fromMigrations).toEqual(fromSchema)
  })
})
