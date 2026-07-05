// Gemini backend — Google's generativelanguage API behind the shared Backend shape. The fallback
// when Claude is down. Copied (non-streaming path only) from MailKite's dashboard abstraction;
// since v1 sends only plain-string turns, the content translation is a straight map to parts.

import {
  ProviderAuthError,
  ProviderUnavailableError,
  type ApiMessage,
  type Backend,
  type CompleteInput,
  type CompleteResult,
} from './types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiPart = { text: string }
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

// Map our canonical messages to Gemini `contents` (assistant → model; everything else → user).
function toContents(messages: ApiMessage[]): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
}

async function postJson(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new ProviderUnavailableError('gemini', 0, `Gemini fetch failed: ${(e as Error).message}`)
  }
}

// Gemini returns 400/403 with API_KEY_INVALID for a bad key. Normalize so the selector skips +
// fails it over (auth vs generic unavailable).
function preStreamError(status: number, detail: string): never {
  const msg = `Gemini API ${status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
    throw new ProviderAuthError('gemini', status, msg)
  }
  throw new ProviderUnavailableError('gemini', status, msg)
}

export const geminiBackend: Backend = {
  id: 'gemini',

  async complete(credential: string, input: CompleteInput): Promise<CompleteResult> {
    const url = `${BASE}/${input.model}:generateContent?key=${encodeURIComponent(credential)}`
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: toContents(input.messages),
      // Gemini 2.5 is a *thinking* model and `maxOutputTokens` counts thinking tokens — so a low
      // cap gets spent reasoning and the visible answer is truncated. These tasks don't need
      // chain-of-thought, so disable thinking (budget 0) to spend the whole budget on the answer.
      generationConfig: { maxOutputTokens: input.maxTokens, thinkingConfig: { thinkingBudget: 0 } },
    }

    const res = await postJson(url, body)
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      preStreamError(res.status, detail)
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    }
    const parts = data.candidates?.[0]?.content?.parts ?? []
    const text = parts.map((p) => ('text' in p ? p.text : '')).join('')
    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    }
  },
}
