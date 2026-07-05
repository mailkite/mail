// Isomorphic backend surface (no Node-only deps). Workers + Node both import this.
export type { SqlDriver, BlobStore } from './ports'
export { MailRepo } from './repo'
export type { IngestOptions } from './repo'
export { SCHEMA_SQL } from './schema'
export { sendViaMailkite } from './send'
export type { SendInput, SendResult, MailkiteClientConfig } from './send'
export { hashPassword, verifyPassword, signSession, verifySession, hashToken } from './auth'
export type { SessionPayload } from './auth'
export { exchangeGoogleCode, decodeGoogleIdToken } from './google'
export type { GoogleIdentity } from './google'
export { exchangeGitHubCode, fetchGitHubIdentity } from './github'
export type { GitHubIdentity } from './github'
// AI assistant: provider abstraction (Claude primary, Gemini fallback) + the four task helpers.
export { runComplete as aiRunComplete, makeRunner, hasProvider, providerLabel, ProviderUnavailableError, ProviderAuthError } from './ai'
export type { AiCredentials, AiRunner, AiRunInput, AiRunResult, ApiMessage } from './ai'
export { summarize, smartReplies, extractTodos, assistantChat } from './ai/tasks'
export type { MessageContext } from './ai/tasks'
export type {
  UserRow, AuthProvider, UserStatus, Role, SenderAccountRow,
  Actor, AddressRow, TeamRow, TeamMemberRow, AddressGrantRow, TodoRow,
} from '../types'
