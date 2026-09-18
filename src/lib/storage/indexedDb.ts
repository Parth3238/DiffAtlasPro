import type { LoadedFile } from '../diff-engine/core/types.ts'

export interface RecentDiff {
  id: string
  original: LoadedFile
  modified: LoadedFile
  createdAt: number
  /** One-line human summary, e.g. "3 added, 1 removed, 2 modified". */
  summaryLine?: string
  /** True when full content was over the size cap and left out of the record. */
  contentOmitted?: boolean
}

const DB_NAME = 'diffatlas'
const DB_VERSION = 1
const STORE_NAME = 'recentDiffs'
/** Only this many recent diffs are kept; older ones are pruned on save. */
export const MAX_HISTORY_ENTRIES = 20

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    request.onblocked = () => reject(new Error('IndexedDB open request was blocked'))
  })
}

export async function saveRecentDiff(diff: RecentDiff): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(diff)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save recent diff'))
      tx.onabort = () => reject(tx.error ?? new Error('Save recent diff aborted'))
    })
    await pruneHistory(db)
  } finally {
    db.close()
  }
}

async function pruneHistory(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => {
      const all = (request.result ?? []) as RecentDiff[]
      all.sort((a, b) => b.createdAt - a.createdAt)
      for (const extra of all.slice(MAX_HISTORY_ENTRIES)) {
        store.delete(extra.id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to prune history'))
    tx.onabort = () => reject(tx.error ?? new Error('Prune history aborted'))
  })
}

export async function listRecentDiffs(limit: number = MAX_HISTORY_ENTRIES): Promise<RecentDiff[]> {
  const db = await openDb()
  try {
    return await new Promise<RecentDiff[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).getAll()
      request.onsuccess = () => {
        const all = (request.result ?? []) as RecentDiff[]
        all.sort((a, b) => b.createdAt - a.createdAt)
        resolve(all.slice(0, limit))
      }
      request.onerror = () => reject(request.error ?? new Error('Failed to list recent diffs'))
    })
  } finally {
    close(db)
  }
}

export async function clearRecentDiffs(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear history'))
      tx.onabort = () => reject(tx.error ?? new Error('Clear history aborted'))
    })
  } finally {
    db.close()
  }
}

export async function getRecentDiff(id: string): Promise<RecentDiff | undefined> {
  const db = await openDb()
  try {
    return await new Promise<RecentDiff | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to get recent diff'))
    })
  } finally {
    close(db)
  }
}

function close(db: IDBDatabase): void {
  db.close()
}
