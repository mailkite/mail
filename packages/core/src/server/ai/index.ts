// Provider selection for the mail assistant. Given the account's resolved credentials, pick a
// backend and run one completion, failing over to the next configured provider when one is
// unavailable (credential rejected, host down, 5xx). Claude is primary; Gemini is the fallback.
//
// This is a simplified port of MailKite's dashboard selector — there is no `ai_providers` D1
// table or health cache here, so selection is a straight ordered walk over whatever keys are set.

import { claudeBackend } from './claude'
import { geminiBackend } from './gemini'
import {
  ProviderUnavailableError,
  type ApiMessage,
  type Backend,
} from './types'

const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6'
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'

// The account's AI credentials, resolved (env → saved settings) by the API layer.
export interface AiCredentials {
  anthropicKey?: string
  anthropicModel?: string
  geminiKey?: string
  geminiModel?: string
}

export interface AiRunInput {
  system: string
  messages: ApiMessage[]
  maxTokens: number
}

export interface AiRunResult {
  text: string
  provider: string // display label: 'Claude' | 'Gemini'
  model: string
}

// A bound completion runner. The AI helpers (summary/todos/…) take one of these, so they never
// see credentials or vendor APIs. The API layer can also inject a stub of this shape for tests.
export type AiRunner = (input: AiRunInput) => Promise<AiRunResult>

interface Candidate {
  backend: Backend
  label: string
  credential: string
  model: string
}

// Configured backends in priority order (Claude first, Gemini fallback).
function candidatesFor(creds: AiCredentials): Candidate[] {
  const out: Candidate[] = []
  if (creds.anthropicKey) {
    out.push({
      backend: claudeBackend,
      label: 'Claude',
      credential: creds.anthropicKey,
      model: creds.anthropicModel || CLAUDE_DEFAULT_MODEL,
    })
  }
  if (creds.geminiKey) {
    out.push({
      backend: geminiBackend,
      label: 'Gemini',
      credential: creds.geminiKey,
      model: creds.geminiModel || GEMINI_DEFAULT_MODEL,
    })
  }
  return out
}

/** Is any AI provider configured? */
export function hasProvider(creds: AiCredentials): boolean {
  return candidatesFor(creds).length > 0
}

/** Display label of the primary configured provider ('Claude' | 'Gemini' | ''). */
export function providerLabel(creds: AiCredentials): string {
  return candidatesFor(creds)[0]?.label ?? ''
}

/** Run one completion through the first available provider, failing over on unavailability. */
export async function runComplete(creds: AiCredentials, input: AiRunInput): Promise<AiRunResult> {
  const candidates = candidatesFor(creds)
  if (candidates.length === 0) throw new Error('No AI provider is configured.')

  let lastErr: unknown
  for (const c of candidates) {
    try {
      const { text } = await c.backend.complete(c.credential, { ...input, model: c.model })
      return { text, provider: c.label, model: c.model }
    } catch (e) {
      lastErr = e
      if (e instanceof ProviderUnavailableError) continue // try the next provider
      throw e // bad-request / non-failover error — surface it
    }
  }
  throw lastErr ?? new Error('All AI providers are unavailable.')
}

/** Bind credentials into a reusable runner for the AI helpers. */
export function makeRunner(creds: AiCredentials): AiRunner {
  return (input) => runComplete(creds, input)
}

export { ProviderAuthError, ProviderUnavailableError } from './types'
export type { ApiMessage } from './types'
