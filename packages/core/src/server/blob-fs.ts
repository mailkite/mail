import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BlobStore } from './ports'

/** Filesystem attachment store for the Node target. R2 is used on Workers. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = join(this.root, key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.root, key)))
    } catch {
      return null
    }
  }
}
