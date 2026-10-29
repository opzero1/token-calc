import { buildDashboardData } from './aggregator.js'
import { loadAll, type LoadAllResult } from './loaders/index.js'
import { enrichCosts } from './pricing.js'
import type { DashboardData } from './types.js'

export * from './aggregator.js'
export * from './pricing.js'
export * from './types.js'

export type TimeRange = '7' | '30' | '90' | '180' | '365' | 'all'

export interface UsageSnapshot extends DashboardData {
  detected: LoadAllResult['detected']
  errors: LoadAllResult['errors']
}

export interface DashboardSnapshot extends UsageSnapshot {
  totalEventCount: number
  range: TimeRange
}

type FreshSnapshot = { loadedAt: number; snapshot: DashboardSnapshot }

type SnapshotCacheEntry = {
  timestamp: number
  value?: DashboardSnapshot
  inFlight?: Promise<FreshSnapshot>
}

type Ingestion = { loadedAt: number; result: LoadAllResult }

const SNAPSHOT_CACHE_TTL_MS = 10_000
const snapshotCache = new Map<string, SnapshotCacheEntry>()
const ingestionInFlight = new Map<string, Promise<Ingestion>>()
const recentIngestions = new Map<string, Ingestion>()

function sourceConfiguration(): string {
  return JSON.stringify([
    'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'GEMINI_DIR',
    'OPENCODE_DATA_DIR', 'OPENCODE_DB', 'OPEN_DOT_HOME', 'AMP_DATA_DIR', 'PI_AGENT_DIR',
  ].map((key) => process.env[key] ?? null))
}

function isFresh(timestamp: number, now = Date.now()): boolean {
  return now >= timestamp && now - timestamp < SNAPSHOT_CACHE_TTL_MS
}

// Requests for other ranges within the cache window reuse the scan; it is then released to free its events.
async function ingest(): Promise<Ingestion> {
  const key = sourceConfiguration()
  const recent = recentIngestions.get(key)
  if (recent && isFresh(recent.loadedAt)) return recent
  const existing = ingestionInFlight.get(key)
  if (existing) return existing
  const pending = loadAll(true).then((result) => {
    const ingestion = { loadedAt: Date.now(), result }
    recentIngestions.set(key, ingestion)
    setTimeout(() => {
      if (recentIngestions.get(key) === ingestion) recentIngestions.delete(key)
    }, SNAPSHOT_CACHE_TTL_MS).unref?.()
    return ingestion
  })
  ingestionInFlight.set(key, pending)
  try { return await pending } finally { ingestionInFlight.delete(key) }
}

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
  const key = JSON.stringify([sourceConfiguration(), range])
  const cached = snapshotCache.get(key)
  if (cached?.value && isFresh(cached.timestamp, now)) {
    return cached.value
  }
  if (cached?.inFlight) {
    return (await cached.inFlight).snapshot
  }

  const inFlight = loadFreshDashboardSnapshot(range)
  snapshotCache.set(key, { timestamp: now, inFlight })

  try {
    const { loadedAt, snapshot } = await inFlight
    snapshotCache.set(key, { timestamp: loadedAt, value: snapshot })
    return snapshot
  } catch (error) {
    snapshotCache.delete(key)
    throw error
  }
}

export async function loadDailySnapshot(date: string): Promise<UsageSnapshot> {
  const { events, detected, errors } = (await ingest()).result
  const dailyEvents = events.filter((event) => new Date(event.timestamp).toISOString().slice(0, 10) === date)
  await enrichCosts(dailyEvents)

  return { ...buildDashboardData(dailyEvents), detected, errors }
}

export async function loadSinceSnapshot(date: string): Promise<UsageSnapshot> {
  const start = Date.parse(`${date}T00:00:00.000Z`)
  const end = Date.now()
  const { events, detected, errors } = (await ingest()).result
  const filteredEvents = events.filter((event) => {
    const timestamp = new Date(event.timestamp).getTime()
    return timestamp >= start && timestamp <= end
  })
  await enrichCosts(filteredEvents)

  return { ...buildDashboardData(filteredEvents), detected, errors }
}

async function loadFreshDashboardSnapshot(range: TimeRange): Promise<FreshSnapshot> {
  const { loadedAt, result } = await ingest()
  const { events, detected, errors } = result
  const filteredEvents = filterEventsByRange(events, range)
  await enrichCosts(filteredEvents)
  return {
    loadedAt,
    snapshot: {
      ...buildDashboardData(filteredEvents),
      detected,
      errors,
      totalEventCount: events.length,
      range,
    },
  }
}
