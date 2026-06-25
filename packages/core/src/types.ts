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
  starred: number
  archived: number
  received_at: number
}

export type Folder = 'inbox' | 'starred' | 'archive'

export type Role = 'admin' | 'user'

export type AuthProvider = 'password' | 'google'
export type UserStatus = 'active' | 'pending' | 'invited'

export interface SenderAccountRow {
  id: string
  address: string
  label: string | null
  created_by: string | null
  created_at: number
}

// ---- ACL (docs/acl.md) -----------------------------------------------------
/** Request-scoped capability built server-side from the session/API key. The
 *  ONLY input to access scoping — never from client input. */
export interface Actor {
  userId: string
  isAdmin: boolean // the owner/admin relation → sees every address
}

export interface AddressRow {
  id: string
  address: string
  label: string | null
  created_at: number
}
export interface TeamRow {
  id: string
  name: string
  created_at: number
}
export interface TeamMemberRow {
  team_id: string
  user_id: string
  role: string
}
export interface AddressGrantRow {
  address_id: string
  user_id: string | null
  team_id: string | null
  created_at: number
}

export interface UserRow {
  id: string
  email: string
  password_hash: string
  role: Role
  created_at: number
  name?: string | null
  provider?: AuthProvider
  google_sub?: string | null
  status?: UserStatus
  invited_by?: string | null
  avatar_url?: string | null
}

export interface MessageFlags {
  unread?: boolean
  starred?: boolean
  archived?: boolean
}

export interface ListOptions {
  folder?: Folder
  q?: string
  limit?: number
}
