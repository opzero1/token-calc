import type { DashboardSnapshot, TimeRange } from '@token-calc/core'

export type WebSnapshot = Pick<
  DashboardSnapshot,
  | 'generated'
  | 'range'
  | 'totals'
  | 'totalEventCount'
  | 'detected'
  | 'errors'
  | 'daily'
  | 'dailyBySource'
  | 'dailyBySourceModel'
  | 'bySource'
  | 'byModel'
  | 'byWeekdayHour'
>

export type SnapshotMap = Partial<Record<TimeRange, WebSnapshot>>

export function toWebSnapshot(snapshot: DashboardSnapshot): WebSnapshot {
  return {
    generated: snapshot.generated,
    range: snapshot.range,
    totals: snapshot.totals,
    totalEventCount: snapshot.totalEventCount,
    detected: snapshot.detected,
    errors: snapshot.errors,
    daily: snapshot.daily,
    dailyBySource: snapshot.dailyBySource,
    dailyBySourceModel: snapshot.dailyBySourceModel,
    bySource: snapshot.bySource,
    byModel: snapshot.byModel,
    byWeekdayHour: snapshot.byWeekdayHour,
  }
}

const CACHE_VERSION = 1
const DATABASE = 'token-calc'
const STORE = 'snapshots'

type CachedSnapshot = { version: number; range: TimeRange; snapshot: WebSnapshot }

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'range' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

export async function readCachedSnapshots(): Promise<SnapshotMap> {
  const database = await openDatabase()
  if (!database) return {}
  try {
    const records = await new Promise<CachedSnapshot[]>((resolve) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result as CachedSnapshot[])
      request.onerror = () => resolve([])
    })
    const snapshots: SnapshotMap = {}
    for (const record of records) {
      if (record.version === CACHE_VERSION) snapshots[record.range] = record.snapshot
    }
    return snapshots
  } catch {
    return {}
  } finally {
    database.close()
  }
}

export async function writeCachedSnapshot(snapshot: WebSnapshot): Promise<void> {
  const database = await openDatabase()
  if (!database) return
  try {
    const record: CachedSnapshot = { version: CACHE_VERSION, range: snapshot.range, snapshot }
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    })
  } catch {
    // The browser cache only speeds up the next visit.
  } finally {
    database.close()
  }
}
