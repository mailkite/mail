import type { BlobStore } from './ports'

// Minimal structural view of the R2 binding (see d1.ts for why we avoid the
// workers-types dependency). The Worker passes its real `env.BLOBS` bucket.
export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>
}
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<R2ObjectBodyLike | null>
}

/** Cloudflare R2 attachment store — the Workers counterpart to FsBlobStore. */
export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(key: string, data: Uint8Array, contentType?: string): Promise<void> {
    await this.bucket.put(key, data, contentType ? { httpMetadata: { contentType } } : undefined)
  }

  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return new Uint8Array(await obj.arrayBuffer())
  }
}
