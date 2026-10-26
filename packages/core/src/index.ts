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

type SnapshotCacheEntry = {
  timestamp: number
  value?: DashboardSnapshot
  inFlight?: Promise<DashboardSnapshot>
}

const SNAPSHOT_CACHE_TTL_MS = 10_000
const snapshotCache = new Map<string, SnapshotCacheEntry>()
const ingestionInFlight = new Map<string, Promise<LoadAllResult>>()

function sourceConfiguration(): string {
  return JSON.stringify([
    'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CODEX_HOME', 'GEMINI_DIR',
    'OPENCODE_DATA_DIR', 'OPENCODE_DB', 'OPEN_DOT_HOME', 'AMP_DATA_DIR', 'PI_AGENT_DIR',
  ].map((key) => process.env[key] ?? null))
}

async function ingest(): Promise<LoadAllResult> {
  const key = sourceConfiguration()
  const existing = ingestionInFlight.get(key)
  if (existing) return existing
  const pending = loadAll(true)
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
  if (cached?.value && now >= cached.timestamp && now - cached.timestamp < SNAPSHOT_CACHE_TTL_MS) {
    return cached.value
  }
  if (cached?.inFlight) {
    return cached.inFlight
  }

  const inFlight = loadFreshDashboardSnapshot(range)
  snapshotCache.set(key, { timestamp: now, inFlight })

  try {
    const value = await inFlight
    snapshotCache.set(key, { timestamp: Date.now(), value })
    return value
  } catch (error) {
    snapshotCache.delete(key)
    throw error
  }
}

export async function loadDailySnapshot(date: string): Promise<UsageSnapshot> {
  const { events, detected, errors } = await ingest()
  const dailyEvents = events.filter((event) => new Date(event.timestamp).toISOString().slice(0, 10) === date)
  await enrichCosts(dailyEvents)

  return { ...buildDashboardData(dailyEvents), detected, errors }
}

export async function loadSinceSnapshot(date: string): Promise<UsageSnapshot> {
  const start = Date.parse(`${date}T00:00:00.000Z`)
  const end = Date.now()
  const { events, detected, errors } = await ingest()
  const filteredEvents = events.filter((event) => {
    const timestamp = new Date(event.timestamp).getTime()
    return timestamp >= start && timestamp <= end
  })
  await enrichCosts(filteredEvents)

  return { ...buildDashboardData(filteredEvents), detected, errors }
}

async function loadFreshDashboardSnapshot(range: TimeRange): Promise<DashboardSnapshot> {
  const { events, detected, errors } = await ingest()
  const filteredEvents = filterEventsByRange(events, range)
  await enrichCosts(filteredEvents)
  return {
    ...buildDashboardData(filteredEvents),
    detected,
    errors,
    totalEventCount: events.length,
    range,
  }
}
