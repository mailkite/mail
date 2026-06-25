import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { Button } from '../components/Button'
import { AuthScreen, Field } from '../components/auth-ui'

/** Shown to a self-registered user who has no mailbox yet (open registration on).
 *  They pick an available address; it becomes their personal mailbox. */
export function ClaimMailbox({
  appName,
  logoUrl,
  onClaimed,
}: {
  appName?: string
  logoUrl?: string
  onClaimed: () => Promise<void>
}) {
  const [address, setAddress] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Debounced availability check as you type.
  useEffect(() => {
    clearTimeout(timer.current)
    const a = address.trim()
    if (!a.includes('@')) { setStatus('idle'); return }
    setStatus('checking')
    timer.current = setTimeout(() => {
      api.checkAddress(a)
        .then((r) => setStatus(r.available ? 'available' : r.reason === 'invalid' ? 'invalid' : 'taken'))
        .catch(() => setStatus('idle'))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [address])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.claimMailbox(address.trim())
      await onClaimed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim that address')
    } finally {
      setBusy(false)
    }
  }

  const hint =
    status === 'checking' ? 'Checking…'
    : status === 'available' ? '✓ available'
    : status === 'taken' ? '✗ already taken'
    : status === 'invalid' ? '✗ not a valid address'
    : ''

  return (
    <AuthScreen
      title="Claim your mailbox"
      subtitle="Pick an available address on this domain — it becomes your personal inbox."
      brandName={appName}
      logoUrl={logoUrl}
    >
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Your address"
          type="email"
          autoFocus
          required
          placeholder="you@domain.com"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        {hint && (
          <p className={`text-sm ${status === 'available' ? 'text-emerald-400' : status === 'checking' ? 'text-[var(--color-muted)]' : 'text-red-400'}`}>
            {hint}
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={busy || status !== 'available'} className="w-full justify-center">
          {busy ? 'Claiming…' : 'Claim mailbox'}
        </Button>
      </form>
    </AuthScreen>
  )
}
