import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { emptyTokens, type UnifiedTokenEvent } from './types.js'

const { loadAll, enrichCosts } = vi.hoisted(() => ({ loadAll: vi.fn(), enrichCosts: vi.fn() }))
vi.mock('./loaders/index.js', () => ({ loadAll }))
vi.mock('./pricing.js', () => ({ enrichCosts }))

function event(timestamp: string): UnifiedTokenEvent {
  return {
    source: 'codex',
    sessionId: 's',
    model: 'model',
    timestamp,
    tokens: { ...emptyTokens(), input: 10 },
    costUSD: 0,
  }
}
const result = (events: UnifiedTokenEvent[]) => ({ events, detected: ['codex'], errors: [] })

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T12:00:00Z'))
  loadAll.mockResolvedValue(result([event('2026-10-26T11:00:00Z'), event('2026-01-01T00:00:00Z')]))
  enrichCosts.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('shares concurrent ingestion across ranges, daily and since requests', async () => {
  const { loadDashboardSnapshot, loadDailySnapshot, loadSinceSnapshot } = await import('./index.js')
  const snapshots = await Promise.all([
    loadDashboardSnapshot('7'),
    loadDashboardSnapshot('all'),
    loadDailySnapshot('2026-10-26'),
    loadSinceSnapshot('2026-10-01'),
  ])
  expect(loadAll).toHaveBeenCalledTimes(1)
  expect(snapshots.map((snapshot) => snapshot.totals.eventCount)).toEqual([1, 2, 1, 1])
})

it('prices only events selected by the dashboard range', async () => {
  const { loadDashboardSnapshot } = await import('./index.js')
  await loadDashboardSnapshot('7')
  expect(enrichCosts.mock.calls[0][0].map((item: UnifiedTokenEvent) => item.timestamp)).toEqual([
    '2026-10-26T11:00:00Z',
  ])
})

it('awaits an expired refresh and shares it instead of reporting stale data as refreshed', async () => {
  const { loadDashboardSnapshot } = await import('./index.js')
  const first = await loadDashboardSnapshot('7')
  expect(await loadDashboardSnapshot('7')).toBe(first)
  vi.mocked(Date.now).mockReturnValue(Date.now() + 10_001)
  loadAll.mockResolvedValue(result([event('2026-10-26T11:00:00Z'), event('2026-10-26T12:00:00Z')]))
  const [updated, shared] = await Promise.all([loadDashboardSnapshot('7'), loadDashboardSnapshot('7')])
  expect(updated.totals.eventCount).toBe(2)
  expect(shared).toBe(updated)
  expect(loadAll).toHaveBeenCalledTimes(2)
})

it('retries a failed ingestion rather than caching a rejected promise', async () => {
  const { loadDashboardSnapshot } = await import('./index.js')
  loadAll.mockRejectedValueOnce(new Error('scan failed'))
  await expect(loadDashboardSnapshot('7')).rejects.toThrow('scan failed')
  expect((await loadDashboardSnapshot('7')).totals.eventCount).toBe(1)
})

it('does not reuse snapshots across different source configurations', async () => {
  const { loadDashboardSnapshot } = await import('./index.js')
  await loadDashboardSnapshot('7')
  vi.stubEnv('CODEX_HOME', '/different/home')
  loadAll.mockResolvedValue(result([]))
  expect((await loadDashboardSnapshot('7')).totals.eventCount).toBe(0)
})
