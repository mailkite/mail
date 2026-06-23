export interface SendInput {
  from: string
  to: string | string[]
  subject: string
  text?: string
  html?: string
  /** Set In-Reply-To + References on the outgoing message for threading. */
  inReplyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
}

export interface SendResult {
  id: string
  status: string
}

export interface MailkiteClientConfig {
  apiBase: string
  apiKey: string
  fetchImpl?: typeof fetch
}

/** Send (or reply to) mail through MailKite's `POST /v1/send`. */
export async function sendViaMailkite(
  input: SendInput,
  cfg: MailkiteClientConfig,
): Promise<SendResult> {
  const doFetch = cfg.fetchImpl ?? fetch
  const res = await doFetch(`${cfg.apiBase}/v1/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`MailKite /v1/send failed: ${res.status} ${detail}`)
  }
  return (await res.json()) as SendResult
}
