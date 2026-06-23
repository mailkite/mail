export interface WebhookAttachment {
  id: string
  filename: string | null
  contentType: string | null
  size: number
  url: string
}

export interface WebhookAuth {
  spf: string | null
  dkim: string | null
  dmarc: string | null
  spam: string | null
}

/** The `email.received` webhook payload MailKite POSTs to our `/webhook`. */
export interface WebhookPayload {
  id: string
  type: 'email.received'
  from: { address: string }
  to: { address: string }[]
  subject: string | null
  text: string | null
  html: string | null
  threadId: string | null
  auth: WebhookAuth
  attachments: WebhookAttachment[]
}

/** A stored message in the own store. */
export interface MessageRow {
  id: string
  thread_id: string
  direction: string
  from_addr: string
  to_addr: string
  subject: string | null
  text_body: string | null
  html_body: string | null
  spf: string | null
  dkim: string | null
  dmarc: string | null
  spam: string | null
  unread: number
  received_at: number
}
