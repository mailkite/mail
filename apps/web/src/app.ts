import { Hono } from 'hono'
import { verifyWebhookSignature } from '@mailkite/core'
import type { WebhookPayload } from '@mailkite/core'
import { MailRepo } from '@mailkite/core/server'

export interface AppDeps {
  repo: MailRepo
  webhookSecret: string
  /** Override attachment fetching (tests inject a stub). Defaults to `fetch`. */
  fetchAttachment?: (url: string) => Promise<Uint8Array>
}

async function defaultFetchAttachment(url: string): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`attachment fetch failed: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

/**
 * The Hono app: the webhook receiver + the local read API. Isomorphic — the
 * Node entry (`node.ts`) and the future Workers entry both mount this.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono()
  const fetchAttachment = deps.fetchAttachment ?? defaultFetchAttachment

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
    if (payload?.type !== 'email.received') {
      return c.json({ error: 'unsupported event' }, 422)
    }

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

  return app
}
