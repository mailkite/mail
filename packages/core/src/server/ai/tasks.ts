// The mail assistant's four AI surfaces, each one non-streaming `complete()` call through a bound
// runner (ai/index.ts). Every helper takes the same provider-neutral MessageContext (built by the
// API layer from a stored MessageRow) so this module never touches the DB or a vendor API.

import type { AiRunner, ApiMessage } from './index'

// What the model is told about the message under discussion. `body` is the plaintext text_body;
// when at-rest encryption is on the API layer passes null (the server only holds ciphertext).
export interface MessageContext {
  from: string
  subject: string | null
  body: string | null
}

const BODY_LIMIT = 6000

// Render the message as a compact block for the prompt. Truncates the body to keep token use sane.
function renderContext(ctx: MessageContext): string {
  const body = (ctx.body ?? '').trim().slice(0, BODY_LIMIT)
  return [
    `From: ${ctx.from}`,
    `Subject: ${ctx.subject ?? '(no subject)'}`,
    '',
    body || '(no readable body)',
  ].join('\n')
}

const clean = (list: unknown[], max: number): string[] =>
  list.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean).slice(0, max)

// Parse a list of strings out of a model reply as robustly as possible. Models return loose or
// even truncated output (a thinking model can cut off mid-array), so we degrade gracefully:
//   1) strict JSON of the bracketed slice (the happy path),
//   2) otherwise pull every COMPLETE double-quoted string — this ignores a dangling/truncated
//      final element instead of throwing,
//   3) otherwise treat non-empty lines as items (stripping bullets/numbering/quotes).
export function parseStringList(text: string, max: number): string[] {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('[')
  const end = s.lastIndexOf(']')
  const jsonish = start !== -1 && end > start ? s.slice(start, end + 1) : s

  try {
    const arr = JSON.parse(jsonish) as unknown
    if (Array.isArray(arr)) return clean(arr, max)
  } catch {
    /* fall through to lenient extraction */
  }

  const quoted = [...jsonish.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try { return JSON.parse(m[0]) as string } catch { return m[1] }
  })
  if (quoted.length) return clean(quoted, max)

  const lines = s
    .split('\n')
    .map((l) => l.replace(/^[\s\-*•\d.)\]]+/, '').replace(/^["']|["']$/g, '').trim())
  return clean(lines, max)
}

// ---- Summary ---------------------------------------------------------------
const SUMMARY_SYSTEM = [
  'You are an email assistant. Summarize the message the user pastes in 1–2 short sentences.',
  'Lead with what it is about and what (if anything) it asks of the reader.',
  'Be plain and neutral. Output only the summary — no preamble, labels, or quotes.',
].join('\n')

export async function summarize(run: AiRunner, ctx: MessageContext): Promise<string> {
  const { text } = await run({
    system: SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: renderContext(ctx) }],
    maxTokens: 300,
  })
  return text.trim()
}

// ---- Smart replies ---------------------------------------------------------
const REPLIES_SYSTEM = [
  'You are an email assistant. Suggest up to 3 brief reply options the reader could send.',
  'Each is one short sentence, ready to send, in the reader\'s voice (first person).',
  'Vary the intent (e.g. accept, defer, ask a question) where it fits the message.',
  '',
  'Output rules — follow exactly:',
  '- Respond with a single JSON array of strings and nothing else (no fences, no commentary).',
  '- Example: ["Sounds good — thanks!", "Can we find time to discuss?", "Got it, I\'ll take a look."]',
].join('\n')

export async function smartReplies(run: AiRunner, ctx: MessageContext): Promise<string[]> {
  const { text } = await run({
    system: REPLIES_SYSTEM,
    messages: [{ role: 'user', content: renderContext(ctx) }],
    maxTokens: 512,
  })
  return parseStringList(text, 3)
}

// ---- Extracted to-dos ------------------------------------------------------
const TODOS_SYSTEM = [
  'You are an email assistant. Extract concrete action items for the reader from the message.',
  'Only include real, actionable tasks the reader must do; skip pleasantries and FYIs.',
  'Each item is a short imperative phrase (e.g. "Reply with availability").',
  '',
  'Output rules — follow exactly:',
  '- Respond with a single JSON array of strings and nothing else (no fences, no commentary).',
  '- If there are no action items, respond with [].',
].join('\n')

export async function extractTodos(run: AiRunner, ctx: MessageContext): Promise<string[]> {
  const { text } = await run({
    system: TODOS_SYSTEM,
    messages: [{ role: 'user', content: renderContext(ctx) }],
    maxTokens: 512,
  })
  return parseStringList(text, 8)
}

// ---- Assistant chat --------------------------------------------------------
const CHAT_SYSTEM = [
  'You are a helpful, friendly assistant inside a mail client, chatting with the person reading the',
  'message below. Talk like a normal person.',
  '',
  'If they just make small talk or greet you ("how are you?", "thanks", "hey"), respond naturally and',
  'briefly like a person would — do NOT lecture them about being an AI, and do NOT steer every reply',
  'back to the email. Match their register.',
  '',
  'When they actually ask you to do something with the message — summarize it, draft a reply, extract',
  'details, answer a question — focus and do that task well. When drafting a reply, return just the',
  'reply text. Keep responses concise.',
].join('\n')

// `history` is the running conversation (user/assistant turns). The message context is injected
// as the system prompt so it grounds every turn without bloating the history.
export async function assistantChat(
  run: AiRunner,
  ctx: MessageContext | null,
  history: ApiMessage[],
): Promise<string> {
  const system = ctx
    ? `${CHAT_SYSTEM}\n\n--- Message under discussion ---\n${renderContext(ctx)}`
    : CHAT_SYSTEM
  const { text } = await run({ system, messages: history, maxTokens: 1024 })
  return text.trim()
}
