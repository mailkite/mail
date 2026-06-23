import { Hono } from 'hono'
import { verifyWebhookSignature } from '@mailkite/core'
import type { WebhookPayload } from '@mailkite/core'
import { MailRepo, sendViaMailkite } from '@mailkite/core/server'
import type { SendInput, SendResult } from '@mailkite/core/server'

export interface AppDeps {
  repo: MailRepo
  webhookSecret: string
  mailkite: { apiBase: string; apiKey: string; from: string }
  /** Override attachment fetching (tests inject a stub). Defaults to `fetch`. */
  fetchAttachment?: (url: string) => Promise<Uint8Array>
  /** Override the sender (tests inject a stub). Defaults to MailKite /v1/send. */
  sendEmail?: (input: SendInput) => Promise<SendResult>
}

async function defaultFetchAttachment(url: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`attachment fetch failed: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

/**
 * The Hono app: webhook receiver + local read API + the reply/send proxy.
 * Isomorphic — the Node entry and the future Workers entry both mount this.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
  const fetchAttachment = deps.fetchAttachment ?? defaultFetchAttachment
  const sendEmail =
    deps.sendEmail ??
    ((input: SendInput) =>
      sendViaMailkite(input, { apiBase: deps.mailkite.apiBase, apiKey: deps.mailkite.apiKey }))

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.post('/webhook', async (c) => {
    const raw = await c.req.text()
    const verdict = await verifyWebhookSignature({
      header: c.req.header('x-mailkite-signature'),
      rawBody: raw,
      secret: deps.webhookSecret,
      now: Date.now(),
    })
    if (!verdict.ok) return c.json({ error: verdict.reason }, 401)

    let payload: WebhookPayload
    try {
      payload = JSON.parse(raw) as WebhookPayload
    } catch {
      return c.json({ error: 'invalid JSON' }, 400)
    }
    if (payload?.type !== 'email.received') return c.json({ error: 'unsupported event' }, 422)

    const { stored } = await deps.repo.ingestWebhookMessage(payload, {
      now: Date.now(),
      fetchAttachment,
    })
    return c.json({ id: payload.id, stored }, stored ? 201 : 200)
  })

  app.get('/api/messages', async (c) => c.json({ messages: await deps.repo.listMessages() }))

  app.get('/api/messages/:id', async (c) => {
    const m = await deps.repo.getMessage(c.req.param('id'))
    return m ? c.json({ message: m }) : c.json({ error: 'not found' }, 404)
  })

  app.post('/api/send', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<SendInput> | null
    if (!body?.to || !body?.subject) {
      return c.json({ error: '`to` and `subject` are required' }, 400)
    }
    if (!deps.mailkite.apiKey) {
      return c.json({ error: 'sending not configured (set MAILKITE_API_KEY)' }, 503)
    }
    try {
      const result = await sendEmail({
        from: deps.mailkite.from,
        to: body.to,
        subject: body.subject,
        text: body.text,
        html: body.html,
        inReplyTo: body.inReplyTo,
        cc: body.cc,
        bcc: body.bcc,
        replyTo: body.replyTo,
      })
      return c.json(result, 201)
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'send failed' }, 502)
    }
  })

  return app
}
