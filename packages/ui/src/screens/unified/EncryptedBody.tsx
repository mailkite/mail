import { useEffect, useMemo, useState } from 'react'
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react'
import { sanitizeEmailHtml } from '../../lib/sanitize'
import { parseEnvelope, decryptEnvelopeWithKey } from '../../lib/envelope'
import { useDecryptionKeys } from '../../lib/decryption-keys'

/**
 * Renders a message body, transparently handling at-rest encryption. Plaintext bodies render exactly
 * as before; an encrypted body (an RSA-OAEP/AES-GCM envelope, see lib/envelope.ts) shows a calm
 * "Encrypted at rest" card until the account holder pastes their private key — then it, and every
 * other message under the same key fingerprint, decrypts in-browser. The key never leaves the tab.
 */
export function EncryptedBody({ htmlBody, textBody }: { htmlBody: string | null; textBody: string | null }) {
  const keys = useDecryptionKeys()
  const htmlEnv = useMemo(() => parseEnvelope(htmlBody), [htmlBody])
  const textEnv = useMemo(() => parseEnvelope(textBody), [textBody])
  const env = htmlEnv ?? textEnv
  const fp = env?.fp
  const unlocked = fp ? keys.isUnlocked(fp) : false

  const [plain, setPlain] = useState<{ html: string | null; text: string | null } | null>(null)
  const [decryptErr, setDecryptErr] = useState<string | null>(null)

  // Decrypt whenever we hold the matching key (unlock / rehydrate flips `keys` identity → re-runs).
  useEffect(() => {
    if (!env || !fp) return
    const key = keys.keyFor(fp)
    if (!key) {
      setPlain(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const html = htmlEnv ? await decryptEnvelopeWithKey(key, htmlEnv) : null
        const text = textEnv ? await decryptEnvelopeWithKey(key, textEnv) : null
        if (alive) {
          setPlain({ html, text })
          setDecryptErr(null)
        }
      } catch (e) {
        if (alive) setDecryptErr(e instanceof Error ? e.message : 'decryption failed')
      }
    })()
    return () => {
      alive = false
    }
  }, [env, fp, htmlEnv, textEnv, keys, unlocked])

  // ---- Plaintext (not encrypted) — unchanged rendering path.
  if (!env || !fp) {
    const safe = htmlBody ? sanitizeEmailHtml(htmlBody) : null
    return safe ? (
      <div dangerouslySetInnerHTML={{ __html: safe }} />
    ) : (
      <pre className="whitespace-pre-wrap font-sans text-[var(--color-text)]">{textBody}</pre>
    )
  }

  // ---- Encrypted + unlocked → render the decrypted body.
  if (plain) {
    const safe = plain.html ? sanitizeEmailHtml(plain.html) : null
    return (
      <div>
        <UnlockedNote fp={fp} onLock={() => keys.lock(fp)} />
        {safe ? (
          <div dangerouslySetInnerHTML={{ __html: safe }} />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-[var(--color-text)]">{plain.text}</pre>
        )}
      </div>
    )
  }

  // ---- Encrypted + locked → the unlock card.
  return <LockedCard fp={fp} env={htmlEnv ?? textEnv!} decryptErr={decryptErr} />
}

function UnlockedNote({ fp, onLock }: { fp: string; onLock: () => void }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
      <LockKeyholeOpen size={13} />
      <span>
        Decrypted in your browser · key <span className="font-mono">{fp.slice(0, 8)}…</span>
      </span>
      <button onClick={onLock} className="ml-auto rounded px-1.5 py-0.5 font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900">
        Lock
      </button>
    </div>
  )
}

function LockedCard({
  fp,
  env,
  decryptErr,
}: {
  fp: string
  env: import('../../lib/envelope').Envelope
  decryptErr: string | null
}) {
  const keys = useDecryptionKeys()
  const [pem, setPem] = useState('')
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canRehydrate = keys.isRemembered(fp)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await keys.unlock(pem, env, remember)
      setPem('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not unlock')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="not-prose rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5">
      <div className="flex items-center gap-2 text-[var(--color-text)]">
        <LockKeyhole size={16} />
        <span className="text-sm font-semibold">Encrypted at rest</span>
      </div>
      <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">
        This message is encrypted to your account key <span className="font-mono">{fp.slice(0, 12)}…</span>. Paste your
        RSA private key to read it — the key stays in this browser and is never sent to the server.
      </p>

      {canRehydrate && (
        <button
          onClick={() => keys.rehydrate(fp)}
          className="mt-3 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90"
        >
          Unlock with remembered key
        </button>
      )}

      <textarea
        value={pem}
        onChange={(e) => setPem(e.target.value)}
        placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----"
        spellCheck={false}
        className="mt-3 h-32 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] p-2.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
      />

      <label className="mt-2 flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember on this device
        <span className="text-[var(--color-muted)]">(stored non-extractably; never re-pasted)</span>
      </label>

      {(err || decryptErr) && <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-400">{err || decryptErr}</p>}

      <button
        onClick={submit}
        disabled={busy || !pem.trim()}
        className="mt-3 rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Decrypting…' : 'Unlock'}
      </button>
    </div>
  )
}
