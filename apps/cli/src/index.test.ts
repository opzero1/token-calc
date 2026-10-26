import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildDashboardData } from '../../../packages/core/src/aggregator.js'
import { emptyTokens } from '../../../packages/core/src/types.js'

const { text, load, add } = vi.hoisted(() => ({ text: vi.fn(), load: vi.fn(), add: vi.fn() }))
vi.mock('@opentui/core', () => ({
  Text: text,
  Box: vi.fn(),
  ScrollBox: vi.fn(),
  createCliRenderer: vi.fn().mockResolvedValue({ keyInput: { on: vi.fn() }, root: { add } }),
}))
vi.mock('@token-calc/core', () => ({
  loadDailySnapshot: load, loadDashboardSnapshot: load, loadSinceSnapshot: load,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  load.mockResolvedValue({
    ...buildDashboardData(['conversation', 'worker', 'observer'].map((role) => ({
      source: 'opencode' as const, timestamp: '2026-10-26T00:00:00Z', sessionId: role,
      model: 'model', tokens: { ...emptyTokens(), input: 100 }, costUSD: 2,
      openDot: { name: 'example', role: role as 'conversation' | 'worker' | 'observer' },
    }))),
    errors: [], detected: ['opencode'],
  })
})
afterEach(() => vi.unstubAllGlobals())

it.each([true, false])('renders attributed roles and respects showCost=%s throughout the CLI', async (showCost) => {
  vi.stubGlobal('Bun', { argv: ['bun', 'index.ts', '--range', 'all', ...(showCost ? [] : ['--no-cost'])] })
  await import('./index.js')
  await vi.waitFor(() => expect(add).toHaveBeenCalledOnce())
  const content = text.mock.calls.map(([options]) => options.content).join('\n')
  expect(content).toContain('open-dot usage (included in OpenCode totals)')
  for (const role of ['conversation', 'worker', 'observer']) {
    expect(content).toContain(`example / ${role}  1 requests  100 tokens`)
  }
  expect(content.includes('$')).toBe(showCost)
})
