// On-device persistence for "Remember on this device" decryption keys. Stores the imported,
// NON-EXTRACTABLE RSA CryptoKey directly in IndexedDB (CryptoKey is structured-cloneable), keyed by
// the envelope fingerprint. Because the key is non-extractable, it survives reloads and can decrypt,
// but scripts can never read its raw bytes back out (exportKey rejects) — so we never persist a PEM
// or any exportable secret. Everything is best-effort (private mode / disabled storage just no-ops).
// See decryption-keys.tsx and docs/architecture.md §1.1.

const DB_NAME = 'mailkite-decryption'
const STORE = 'keys'

// One persisted, remembered decryption key: the non-extractable CryptoKey plus the metadata the
// manager UI shows. `fp` is the envelope/public-key fingerprint this key decrypts.
export interface StoredKey {
  fp: string
  key: CryptoKey
  label: string
  addedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'fp' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

// Wrap a store transaction in a promise; swallow open failures (storage unavailable) by returning a
// fallback so callers degrade to session-only memory rather than throwing.
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> {
  let db: IDBDatabase
  try {
    db = await openDb()
  } catch {
    return fallback
  }
  return new Promise<T>((resolve) => {
    let req: IDBRequest
    try {
      req = run(db.transaction(STORE, mode).objectStore(STORE))
    } catch {
      resolve(fallback)
      return
    }
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => resolve(fallback)
  })
}

export const putKey = (rec: StoredKey): Promise<unknown> => tx('readwrite', (s) => s.put(rec), undefined)
export const getAllKeys = (): Promise<StoredKey[]> => tx<StoredKey[]>('readonly', (s) => s.getAll(), [])
export const deleteKey = (fp: string): Promise<unknown> => tx('readwrite', (s) => s.delete(fp), undefined)
export const clearKeys = (): Promise<unknown> => tx('readwrite', (s) => s.clear(), undefined)
