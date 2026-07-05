// The provider "shape" — the single interface every model backend (Claude, Gemini) implements,
// plus the provider-neutral message/usage types the AI helpers speak. Providers translate this
// shape to/from their own wire format, so the AI helpers (ai/summary.ts, ai/assistant.ts, …)
// never see a vendor API.
//
// This is a trimmed copy of MailKite's dashboard provider abstraction: v1 of the mail assistant
// is one-shot and tool-free, so only the non-streaming `complete()` path is kept — the streaming
// tool-loop, ToolDef, and D1 health cache from the source are dropped.

// A provider-neutral chat message. v1 only ever sends plain-string turns.
export interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

// Token counts for a completion (surfaced for logging; not billed here).
export interface Usage {
  inputTokens: number
  outputTokens: number
}

// A backend is "unavailable" when the request fails BEFORE any text comes back — the credential
// is rejected (auth), the host is unreachable, or it returns 5xx. The selector treats these as
// "this provider is down" and falls over to the next configured provider. A bad-request (4xx that
// isn't auth) throws a plain Error instead — it won't be retried and won't trigger failover.
export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}

// The credential itself was rejected (HTTP 401, or Gemini's API_KEY_INVALID). A subtype of
// unavailable so it triggers the same skip-and-failover, but distinguishable in logs.
export class ProviderAuthError extends ProviderUnavailableError {
  constructor(provider: string, status: number, message: string) {
    super(provider, status, message)
    this.name = 'ProviderAuthError'
  }
}

// ---- complete: one non-streaming, tool-free model turn ---------------------
export interface CompleteInput {
  model: string
  system: string
  messages: ApiMessage[]
  maxTokens: number
}

export interface CompleteResult {
  text: string
  usage: Usage
}

// The wire implementation for one vendor. Pure-ish: takes a resolved credential + input (the
// model is in the input) and talks the vendor API.
export interface Backend {
  readonly id: 'claude' | 'gemini'
  complete(credential: string, input: CompleteInput): Promise<CompleteResult>
}
