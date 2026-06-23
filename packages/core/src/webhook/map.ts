import type { WebhookPayload, MessageRow } from '../types'

/** Map an `email.received` webhook payload to the columns of a local message row. */
export function mapWebhookToMessage(
  p: WebhookPayload,
  receivedAt: number,
): Omit<MessageRow, 'direction' | 'unread'> {
  return {
    id: p.id,
    thread_id: p.threadId ?? p.id,
    from_addr: p.from.address,
    to_addr: p.to?.[0]?.address ?? '',
    subject: p.subject,
    text_body: p.text,
    html_body: p.html,
    spf: p.auth?.spf ?? null,
    dkim: p.auth?.dkim ?? null,
    dmarc: p.auth?.dmarc ?? null,
    spam: p.auth?.spam ?? null,
    received_at: receivedAt,
  }
}
