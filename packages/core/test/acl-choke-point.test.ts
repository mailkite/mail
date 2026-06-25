import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// The ACL choke point is only real if it's mechanically enforced: the database
// surface (the SqlDriver methods, and raw `.prepare`) must be reachable from
// exactly one module. This is the lint that makes "every query is scoped" a
// structural fact, not developer discipline (docs/acl.md §8).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..') // mailkite-mail root
const SCAN_DIRS = ['packages/core/src', 'apps/web/src']
const REPO = 'packages/core/src/server/repo.ts' // the one place that may run queries
const DRIVERS = ['packages/core/src/server/sqlite.ts', 'packages/core/src/server/d1.ts'] // the only `.prepare`

function sources(dir: string): string[] {
  const out: string[] = []
  const abs = resolve(ROOT, dir)
  for (const name of readdirSync(abs, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name === 'dist') continue
    const p = `${dir}/${name.name}`
    if (name.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(name.name) && !/\.test\.tsx?$/.test(name.name)) out.push(p)
  }
  return out
}
const FILES = SCAN_DIRS.flatMap(sources)
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('ACL choke point — only the repository touches the database', () => {
  it('found a meaningful number of source files', () => {
    expect(FILES.length).toBeGreaterThan(10)
  })

  it('no SqlDriver query calls (.sql.run/get/all/exec) outside the repository', () => {
    const surface = /\.sql\.(run|get|all|exec)\s*\(/
    const offenders = FILES.filter((f) => f !== REPO && surface.test(read(f)))
    expect(offenders, 'database access escaped the repository choke point').toEqual([])
  })

  it('no raw .prepare() outside the driver implementations', () => {
    const offenders = FILES.filter((f) => !DRIVERS.includes(f) && /\.prepare\s*\(/.test(read(f)))
    expect(offenders, 'raw prepared statements outside the drivers').toEqual([])
  })
})
