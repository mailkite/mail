import { useState, type FormEvent } from 'react'
import { Button } from '../components/Button'
import { AuthScreen, Field } from '../components/auth-ui'

/**
 * First-run wizard — shown while the app reports `needsSetup` (no admin and no
 * ADMIN_PASSWORD env). Creates the first admin via POST /api/admin/setup, which
 * also starts the session.
 */
export function SetupWizard({ onCreate }: { onCreate: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScreen title="Create your admin account" subtitle="First run — this account configures and manages the app.">
      <form onSubmit={submit} className="space-y-3">
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? 'Creating…' : 'Create admin & continue'}
        </Button>
      </form>
    </AuthScreen>
  )
}
