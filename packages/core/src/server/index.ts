// Isomorphic backend surface (no Node-only deps). Workers + Node both import this.
export type { SqlDriver, BlobStore } from './ports'
export { MailRepo } from './repo'
export type { IngestOptions } from './repo'
export { SCHEMA_SQL } from './schema'
