import { buildDashboardData } from './aggregator.js'
import { loadAll, type LoadAllResult } from './loaders/index.js'
import { enrichCosts } from './pricing.js'
import type { DashboardData } from './types.js'

export * from './aggregator.js'
export * from './pricing.js'
export * from './types.js'

export type TimeRange = '7' | '30' | '90' | '180' | '365' | 'all'

export interface DashboardSnapshot extends DashboardData {
  detected: LoadAllResult['detected']
  errors: LoadAllResult['errors']
  totalEventCount: number
  range: TimeRange
}

type SnapshotCacheEntry = {
  timestamp: number
  value?: DashboardSnapshot
  inFlight?: Promise<DashboardSnapshot>
}

const SNAPSHOT_CACHE_TTL_MS = 10_000
const snapshotCache = new Map<TimeRange, SnapshotCacheEntry>()

function filterEventsByRange(
  events: LoadAllResult['events'],
  range: TimeRange,
): LoadAllResult['events'] {
  if (range === 'all') return events

  const days = Number(range)
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return events.filter((event) => new Date(event.timestamp).getTime() >= cutoff)
}

export async function loadDashboardSnapshot(range: TimeRange = '90'): Promise<DashboardSnapshot> {
  const now = Date.now()
  const cached = snapshotCache.get(range)
  if (cached?.value) {
    if (now - cached.timestamp >= SNAPSHOT_CACHE_TTL_MS && !cached.inFlight) {
      const inFlight = loadFreshDashboardSnapshot(range)
      snapshotCache.set(range, { ...cached, inFlight })
      void inFlight.then(
        (value) => snapshotCache.set(range, { timestamp: Date.now(), value }),
        () => snapshotCache.set(range, cached),
      )
    }
    return cached.value
  }
  if (cached?.inFlight) {
    return cached.inFlight
  }

  const inFlight = loadFreshDashboardSnapshot(range)
  snapshotCache.set(range, { timestamp: now, value: cached?.value, inFlight })

  try {
    const value = await inFlight
    snapshotCache.set(range, { timestamp: Date.now(), value })
    return value
  } catch (error) {
    snapshotCache.delete(range)
    throw error
  }
}

async function loadFreshDashboardSnapshot(range: TimeRange): Promise<DashboardSnapshot> {
  const { events, detected, errors } = await loadAll(true)
  await enrichCosts(events)

  const filteredEvents = filterEventsByRange(events, range)
  return {
    ...buildDashboardData(filteredEvents),
    detected,
    errors,
    totalEventCount: events.length,
    range,
  }
}
