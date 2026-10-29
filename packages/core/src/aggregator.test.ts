import { afterEach, expect, it, vi } from 'vitest'
import { aggregateByWeekdayHour, aggregateDaily, aggregateMonthly } from './aggregator.js'
import { emptyTokens, type UnifiedTokenEvent } from './types.js'

function event(timestamp: string, costUSD = 1): UnifiedTokenEvent {
  return { source: 'codex', sessionId: 's', model: 'model', timestamp, tokens: { ...emptyTokens(), input: 10 }, costUSD }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

it('keys UTC and offset timestamps by their UTC date', () => {
  const events = [
    event('2024-02-29T23:59:59.999Z'),
    event('2024-03-01T07:59:59.999+08:00'),
    event('2024-03-01T00:00:00Z'),
    event('2024-02-29T23:00:00.000-01:00'),
  ]
  expect(aggregateDaily(events).map(({ date, eventCount }) => [date, eventCount])).toEqual([
    ['2024-02-29', 2],
    ['2024-03-01', 2],
  ])
  expect(aggregateMonthly(events).map(({ month, eventCount }) => [month, eventCount])).toEqual([
    ['2024-02', 2],
    ['2024-03', 2],
  ])
})

it('groups usage by local weekday and hour', () => {
  vi.stubEnv('TZ', 'Asia/Kuala_Lumpur')
  const cells = aggregateByWeekdayHour([
    event('2026-10-25T17:30:00Z', 2),
    event('2026-10-25T17:59:00Z', 3),
    event('2026-10-26T01:15:00Z', 4),
  ])
  expect(cells).toEqual([
    { weekday: 1, hour: 1, totalTokens: 20, costUSD: 5, eventCount: 2 },
    { weekday: 1, hour: 9, totalTokens: 10, costUSD: 4, eventCount: 1 },
  ])
})
