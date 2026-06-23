import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { api, type AdminConfigItem } from '../lib/api'
import { Button } from '../components/Button'

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
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
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
