// Claude backend — the Anthropic Messages API wire implementation. Auto-detects the credential
// by prefix: an `sk-ant-oat…` subscription (OAuth) token uses Bearer + the oauth beta header and
// MUST present the Claude Code identity as its first system block, while a normal `sk-ant-api…`
// key uses x-api-key.
//
// Copied (non-streaming path only) from MailKite's dashboard provider abstraction.

import {
  ProviderAuthError,
  ProviderUnavailableError,
  type Backend,
  type CompleteInput,
  type CompleteResult,
} from './types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const OAUTH_PREFIX = 'sk-ant-oat'
const OAUTH_BETA = 'oauth-2025-04-20'
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

const isOAuthToken = (key: string) => key.startsWith(OAUTH_PREFIX)

// Shared auth wiring. OAuth tokens require the Claude Code identity prepended as a structured
// system block; API keys take the system prompt directly.
function authFor(key: string, system: string) {
  const oauth = isOAuthToken(key)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
  if (oauth) {
    headers['authorization'] = `Bearer ${key}`
    headers['anthropic-beta'] = OAUTH_BETA
  } else {
    headers['x-api-key'] = key
  }
  const systemField = oauth
    ? [{ type: 'text', text: CLAUDE_CODE_IDENTITY }, { type: 'text', text: system }]
    : system
  return { headers, systemField }
}

// Map a pre-stream failure to the right error type: 401 → auth (skip + failover),
// anything else non-2xx / connect failure → unavailable (skip + failover).
function preStreamError(status: number, detail: string): never {
  const msg = `Anthropic API ${status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
  if (status === 401) throw new ProviderAuthError('claude', 401, msg)
  throw new ProviderUnavailableError('claude', status, msg)
}

export const claudeBackend: Backend = {
  id: 'claude',

  async complete(credential: string, input: CompleteInput): Promise<CompleteResult> {
    const { headers, systemField } = authFor(credential, input.system)

    let res: Response
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model,
          max_tokens: input.maxTokens,
          system: systemField,
          messages: input.messages,
        }),
      })
    } catch (e) {
      throw new ProviderUnavailableError('claude', 0, `Anthropic fetch failed: ${(e as Error).message}`)
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      preStreamError(res.status, detail)
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    }
  },
}
