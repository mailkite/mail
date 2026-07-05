import { useEffect, useState, type FormEvent } from 'react'
import { Check, LockKeyhole, Trash2 } from 'lucide-react'
import { api, type AdminConfigItem, type TeamUser, type SenderAccount, type EncryptionStatus } from '../lib/api'
import { Button } from '../components/Button'
import { Logo } from '../components/Logo'
import { AccessSection } from './AccessSection'

const BRANDING_KEYS = ['APP_NAME', 'LOGO_URL']
const inputCls =
  'w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]'

function BrandingSection() {
  const [name, setName] = useState('')
  const [logo, setLogo] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.config().then((c) => { setName(c.appName || ''); setLogo(c.logoUrl || '') }).catch(() => {})
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.saveConfig('APP_NAME', name.trim())
      await api.saveConfig('LOGO_URL', logo.trim())
      if (name.trim()) document.title = name.trim()
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Branding</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Your app’s name and logo. The logo is a URL to an image; leave it blank for the MailKite kite.
        </p>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-muted)]">Preview</span>
          <Logo name={name || 'MailKite Mail'} logoUrl={logo || undefined} />
        </div>
        <form onSubmit={save} className="space-y-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--color-muted)]">App name</span>
            <input className={inputCls} placeholder="MailKite Mail" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[var(--color-muted)]">Logo URL</span>
            <input className={inputCls} placeholder="https://…/logo.svg" value={logo} onChange={(e) => setLogo(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={busy}>{saved ? <Check size={16} /> : busy ? 'Saving…' : 'Save'}</Button>
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

function SendersSection() {
  const [senders, setSenders] = useState<SenderAccount[] | null>(null)
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try { setSenders(await api.senders()) } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load senders') }
  }
  useEffect(() => { void load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.createSender(address.trim(), label.trim() || undefined)
      setAddress(''); setLabel('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add address')
    } finally {
      setBusy(false)
    }
  }

  async function remove(s: SenderAccount) {
    try { await api.removeSender(s.id); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Remove failed') }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Sender addresses</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Provision addresses on your domain to send as — <code>support@</code>, <code>hello@</code>, or
          per-person. Anyone on the team can send from any of them.
        </p>
      </div>

      <form onSubmit={add} className="flex gap-2">
        <input
          type="email"
          required
          placeholder="support@yourdomain.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="flex-[2] rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <Button type="submit" disabled={busy || !address.trim()}>{busy ? 'Adding…' : 'Add'}</Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {!senders && <p className="p-3 text-sm text-[var(--color-muted)]">Loading…</p>}
        {senders?.length === 0 && <p className="p-3 text-sm text-[var(--color-muted)]">No sender addresses yet.</p>}
        {senders?.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{s.address}</div>
              {s.label && <div className="text-xs text-[var(--color-muted)]">{s.label}</div>}
            </div>
            <button onClick={() => remove(s)} title="Remove" className="text-[var(--color-muted)] hover:text-red-400">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

const STATUS_BADGE: Record<TeamUser['status'], [string, string]> = {
  active: ['Active', 'text-emerald-300 bg-emerald-500/10'],
  invited: ['Invited', 'text-amber-300 bg-amber-500/10'],
  pending: ['Unverified', 'text-sky-300 bg-sky-500/10'],
}

function TeamSection() {
  const [users, setUsers] = useState<TeamUser[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try { setUsers(await api.users()) } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load team') }
  }
  useEffect(() => { void load() }, [])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await api.inviteUser(email.trim(), role)
      setEmail('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(u: TeamUser) {
    if (!confirm(`Remove ${u.email} from the team?`)) return
    try { await api.removeUser(u.id); await load() } catch (e) { setError(e instanceof Error ? e.message : 'Remove failed') }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Team</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Invite teammates by email. They join by signing in (email code or Google) with that
          address; uninvited sign-ins are rejected.
        </p>
      </div>

      <form onSubmit={invite} className="flex gap-2">
        <input
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-2 text-sm outline-none"
        >
          <option value="user">Member</option>
          <option value="admin">Admin</option>
        </select>
        <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Inviting…' : 'Invite'}</Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {!users && <p className="p-3 text-sm text-[var(--color-muted)]">Loading…</p>}
        {users?.map((u) => {
          const [label, cls] = STATUS_BADGE[u.status]
          return (
            <div key={u.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{u.email}</div>
                <div className="text-xs text-[var(--color-muted)]">
                  {u.role === 'admin' ? 'Admin' : 'Member'} ·{' '}
                  {u.provider === 'google' ? 'Google' : u.provider === 'github' ? 'GitHub' : 'Password'}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
              <button onClick={() => remove(u)} title="Remove" className="text-[var(--color-muted)] hover:text-red-400">
                <Trash2 size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

const LABELS: Record<string, string> = {
  MAILKITE_API_KEY: 'MailKite API key',
  MAILKITE_WEBHOOK_SECRET: 'Webhook secret',
  MAILKITE_API_BASE: 'API base URL',
  MAILKITE_FROM: 'From address',
}
const GATE_LABELS: Record<string, string> = {
  sending: 'Sending & replies',
  ingest: 'Inbound mail',
}

const SOURCE: Record<AdminConfigItem['source'], [string, string]> = {
  env: ['Environment', 'text-sky-300 bg-sky-500/10'],
  saved: ['Saved', 'text-emerald-300 bg-emerald-500/10'],
  unset: ['Not set', 'text-amber-300 bg-amber-500/10'],
}

function SourceBadge({ source }: { source: AdminConfigItem['source'] }) {
  const [label, cls] = SOURCE[source]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

function ConfigRow({ item, onSaved }: { item: AdminConfigItem; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Platform env always wins on the server, so the UI can't override it.
  const envManaged = item.source === 'env'

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await api.saveConfig(item.key, value)
      setValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{LABELS[item.key] ?? item.key}</div>
          {item.gates && (
            <div className="text-xs text-[var(--color-muted)]">Enables {GATE_LABELS[item.gates] ?? item.gates}</div>
          )}
        </div>
        <SourceBadge source={item.source} />
      </div>

      {envManaged ? (
        <p className="text-xs text-[var(--color-muted)]">
          Managed by the environment (<code>{item.key}</code>) — set on the host, not here.
        </p>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type={item.secret ? 'password' : 'text'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={item.value ? `Current: ${item.value}` : 'Not set — enter a value'}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <Button onClick={save} disabled={busy || !value.trim()}>
              {saved ? <Check size={16} /> : busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </div>
  )
}

/** At-rest encryption: paste the account's RSA PUBLIC key so every future inbound body is encrypted
 *  before it's stored. Only the private-key holder can then read mail (they decrypt in the browser —
 *  see EncryptedBody). We validate the key and show its fingerprint; we never hold the private key. */
function EncryptionSection() {
  const [status, setStatus] = useState<EncryptionStatus | null>(null)
  const [pem, setPem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setStatus(await api.encryption())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load encryption status')
    }
  }
  useEffect(() => {
    void load()
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.setEncryption(pem.trim())
      setPem('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    try {
      await api.disableEncryption()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable')
    } finally {
      setBusy(false)
    }
  }

  const envManaged = status?.source === 'env'

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <LockKeyhole size={17} /> At-rest encryption
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Encrypt every incoming message body before it’s stored, so no one — not even this server’s
          operator — can read it without your private key. Paste your RSA <strong>public</strong> key
          (SPKI PEM, ≥2048-bit). Subject, sender, and recipient stay readable so the inbox list works.
          <strong> Losing the private key means permanently losing that mail.</strong>
        </p>
      </div>
      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        {status?.enabled ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                <Check size={13} /> On
              </span>
              {status.invalid ? (
                <span className="text-red-400">stored key no longer parses: {status.error}</span>
              ) : (
                <span className="text-[var(--color-muted)]">
                  key <span className="font-mono">{status.fingerprint?.slice(0, 16)}…</span> · {status.alg}
                </span>
              )}
            </div>
            {envManaged ? (
              <p className="text-xs text-[var(--color-muted)]">
                Set via the <code>ENC_PUBLIC_KEY</code> environment variable — change it there.
              </p>
            ) : (
              <Button onClick={disable} disabled={busy} variant="ghost">
                <Trash2 size={15} /> Turn off (existing encrypted mail stays encrypted)
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="inline-flex items-center rounded-full bg-[var(--color-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted)]">
              Off — bodies stored in plain text
            </span>
            <form onSubmit={save} className="space-y-2">
              <textarea
                className={inputCls + ' h-32 resize-y font-mono text-xs'}
                placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'}
                spellCheck={false}
                value={pem}
                onChange={(e) => setPem(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy || !pem.trim()}>
                  {busy ? 'Validating…' : 'Enable encryption'}
                </Button>
                {error && <span className="text-sm text-red-400">{error}</span>}
              </div>
            </form>
            <p className="text-xs text-[var(--color-muted)]">
              Generate a keypair:{' '}
              <code>openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem</code>{' '}
              then <code>openssl rsa -in private.pem -pubout -out public.pem</code>. Paste{' '}
              <code>public.pem</code> here; keep <code>private.pem</code> safe.
            </p>
          </>
        )}
        {status?.enabled && error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </section>
  )
}

/** Admin-only config surface — status per key, with inputs to save the
 *  non-platform ones (GET/POST /api/admin/config). */
export function Settings() {
  const [items, setItems] = useState<AdminConfigItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setItems(await api.adminConfig())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Settings</h1>

        <AccessSection />

        <BrandingSection />

        <SendersSection />

        <EncryptionSection />

        <TeamSection />

        <div className="pt-2">
          <h2 className="text-lg font-semibold">Configuration</h2>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Keys each feature needs. Values set in the environment win and can’t be changed here; the
            rest can be saved below. A feature stays disabled until its key is present.
          </p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!items && !error && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        {items?.map((it) => (
          <ConfigRow key={it.key} item={it} onSaved={load} />
        ))}
      </div>
    </div>
  )
}
