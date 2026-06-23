/** Minimal async SQL surface, implemented by SQLite (Node) and D1 (Workers). */
export interface SqlDriver {
  exec(sql: string): Promise<void>
  run(sql: string, params?: unknown[]): Promise<void>
  get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>
  all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
}

/** Attachment byte store: filesystem (Node) or R2 (Workers). */
export interface BlobStore {
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>
  get(key: string): Promise<Uint8Array | null>
}
