import { describe, it, expect } from 'vitest'
import { sendViaMailkite, type SendInput } from '../src/server/index'

describe('sendViaMailkite', () => {
  it('POSTs to /v1/send with bearer auth and returns the result', async () => {
    let captured: { url: string; init: RequestInit } | null = null
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init! }
      return new Response(JSON.stringify({ id: 'out_1', status: 'queued' }), { status: 201 })
    }) as unknown as typeof fetch

    const input: SendInput = {
      from: 'me@mailn.app', to: 'a@b.com', subject: 'Re: Hi', text: 'hello', inReplyTo: 'msg_1',
    }
    const res = await sendViaMailkite(input, { apiBase: 'https://api.mailkite.dev', apiKey: 'jwt_x', fetchImpl })

    expect(res).toEqual({ id: 'out_1', status: 'queued' })
    expect(captured!.url).toBe('https://api.mailkite.dev/v1/send')
    expect((captured!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt_x')
    expect(JSON.parse(captured!.init.body as string).inReplyTo).toBe('msg_1')
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 403 })) as unknown as typeof fetch
    await expect(
      sendViaMailkite({ from: 'me@mailn.app', to: 'a@b.com', subject: 'x' }, { apiBase: 'https://api.mailkite.dev', apiKey: 'k', fetchImpl }),
    ).rejects.toThrow(/403/)
  })
})
