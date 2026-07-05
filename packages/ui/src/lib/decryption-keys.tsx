// The decryption-key store: holds the imported, non-extractable RSA private keys that unlock
// at-rest-encrypted mail, keyed by envelope fingerprint (env.fp). Unlock once and every message whose
// fp matches decrypts with the held key — no per-message re-paste.
//
// Lifetime model (see docs/architecture.md §1.1):
//   • Session keys live only in this tab's memory (gone on refresh/close/Lock).
//   • "Remember on this device" also persists the non-extractable CryptoKey in IndexedDB
//     (key-vault.ts); those auto-hydrate (unlocked) on load and survive reloads.
//   • Lock / Lock all / idle-timeout clear keys from MEMORY only — remembered keys re-unlock
//     instantly (no paste) from IndexedDB; session keys must be re-pasted.
//   • Forget deletes a key from the device (memory + IndexedDB).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { importPrivateKey, decryptEnvelopeWithKey, type Envelope } from './envelope'
import { getAllKeys, putKey, deleteKey, type StoredKey } from './key-vault'

// Auto-lock after this much inactivity — clears in-memory keys (remembered ones re-hydrate on demand).
const IDLE_MS = 30 * 60 * 1000

interface HeldKey {
  key: CryptoKey
  label: string
  remembered: boolean
  addedAt: number
}
// What the manager UI needs about an unlocked fingerprint (no raw key material).
export interface UnlockedEntry {
  fp: string
  label: string
  remembered: boolean
  addedAt: number
}

interface DecryptionKeysValue {
  /** Add a key for the message's fingerprint after verifying it actually decrypts `env`. */
  unlock: (pem: string, env: Envelope, remember: boolean) => Promise<void>
  /** Re-unlock a remembered fp from IndexedDB without re-pasting (after a Lock / idle-lock). */
  rehydrate: (fp: string) => boolean
  keyFor: (fp: string) => CryptoKey | undefined
  isUnlocked: (fp: string) => boolean
  isRemembered: (fp: string) => boolean
  unlockedList: () => UnlockedEntry[]
  lock: (fp: string) => void
  lockAll: () => void
  forget: (fp: string) => void
}

const Ctx = createContext<DecryptionKeysValue | null>(null)

export function DecryptionKeysProvider({ children }: { children: ReactNode }) {
  const [held, setHeld] = useState<Map<string, HeldKey>>(new Map())
  // Cached IndexedDB records for remembered fps — lets `rehydrate` and `isRemembered` work
  // synchronously after the initial load.
  const remembered = useRef<Map<string, StoredKey>>(new Map())

  // Hydrate remembered keys on mount — those fingerprints come up already unlocked.
  useEffect(() => {
    let alive = true
    void getAllKeys().then((rows) => {
      if (!alive || rows.length === 0) return
      remembered.current = new Map(rows.map((r) => [r.fp, r]))
      setHeld((prev) => {
        const next = new Map(prev)
        for (const r of rows) next.set(r.fp, { key: r.key, label: r.label, remembered: true, addedAt: r.addedAt })
        return next
      })
    })
    return () => {
      alive = false
    }
  }, [])

  const lock = useCallback((fp: string) => {
    setHeld((prev) => {
      if (!prev.has(fp)) return prev
      const next = new Map(prev)
      next.delete(fp)
      return next
    })
  }, [])

  const lockAll = useCallback(() => setHeld((prev) => (prev.size === 0 ? prev : new Map())), [])

  // Idle auto-lock: while any key is in memory, lock all after IDLE_MS of no interaction.
  useEffect(() => {
    if (held.size === 0) return
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(lockAll, IDLE_MS)
    }
    const events = ['pointerdown', 'keydown', 'visibilitychange'] as const
    for (const e of events) window.addEventListener(e, reset, { passive: true })
    reset()
    return () => {
      clearTimeout(timer)
      for (const e of events) window.removeEventListener(e, reset)
    }
  }, [held.size, lockAll])

  const unlock = useCallback(async (pem: string, env: Envelope, remember: boolean) => {
    const key = await importPrivateKey(pem) // throws a human-readable error for a malformed PEM
    await decryptEnvelopeWithKey(key, env) // throws if this key doesn't match the message's fingerprint
    // A short fingerprint prefix is the label the manager UI shows (the fp is what gates decryption).
    const label = `key ${env.fp.slice(0, 8)}…`
    const rec: StoredKey = { fp: env.fp, key, label, addedAt: Date.now() }
    if (remember) {
      remembered.current.set(env.fp, rec)
      void putKey(rec)
    }
    setHeld((prev) => new Map(prev).set(env.fp, { key, label, remembered: remember, addedAt: rec.addedAt }))
  }, [])

  const rehydrate = useCallback((fp: string) => {
    const rec = remembered.current.get(fp)
    if (!rec) return false
    setHeld((prev) => new Map(prev).set(fp, { key: rec.key, label: rec.label, remembered: true, addedAt: rec.addedAt }))
    return true
  }, [])

  const forget = useCallback(
    (fp: string) => {
      remembered.current.delete(fp)
      void deleteKey(fp)
      lock(fp)
    },
    [lock],
  )

  const value = useMemo<DecryptionKeysValue>(
    () => ({
      unlock,
      rehydrate,
      keyFor: (fp) => held.get(fp)?.key,
      isUnlocked: (fp) => held.has(fp),
      isRemembered: (fp) => remembered.current.has(fp),
      unlockedList: () =>
        [...held.entries()].map(([fp, h]) => ({ fp, label: h.label, remembered: h.remembered, addedAt: h.addedAt })),
      lock,
      lockAll,
      forget,
    }),
    [held, unlock, rehydrate, lock, lockAll, forget],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDecryptionKeys(): DecryptionKeysValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDecryptionKeys must be used within DecryptionKeysProvider')
  return v
}
