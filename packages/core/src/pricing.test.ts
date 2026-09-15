import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyTokens } from './types.js'

const astraPricing = {
  input_cost_per_token: 10e-6,
  output_cost_per_token: 50e-6,
  cache_read_input_token_cost: 1e-6,
  cache_creation_input_token_cost: 12.5e-6,
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    'azure_ai/gpt-6-astra': astraPricing,
    'gpt-6-astra': astraPricing,
  })))
})

afterEach(() => vi.unstubAllGlobals())

describe('Astra Fast pricing', () => {
  it.each([
    ['input', 20],
    ['output', 100],
    ['cacheRead', 2],
    ['cacheCreation', 25],
  ] as const)('charges double the standard rate for %s', async (tokenType, expected) => {
    const { calculateCost } = await import('./pricing.js')
    const tokens = { ...emptyTokens(), [tokenType]: 1_000_000 }
    expect(await calculateCost('gpt-6-astra', tokens)).toBeCloseTo(expected / 2)
    expect(await calculateCost('gpt-6-astra-fast', tokens)).toBeCloseTo(expected)
  })

  it.each(['openai/gpt-6-astra-fast', 'openrouter/openai/gpt-6-astra-fast', '[pi] gpt-6-astra-fast'])(
    'recognizes %s', async (model) => {
      const { calculateCost } = await import('./pricing.js')
      expect(await calculateCost(model, { ...emptyTokens(), input: 1_000_000 })).toBeCloseTo(20)
    },
  )

  it('uses double Astra rates when the pricing feed is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { calculateCost } = await import('./pricing.js')
    expect(await calculateCost('gpt-6-astra-fast', { ...emptyTokens(), cacheRead: 1_000_000 })).toBeCloseTo(2)
  })

  it('corrects the September 8 estimate and preserves recorded costs', async () => {
    const { enrichCosts } = await import('./pricing.js')
    const tokens = { input: 12_309_060, output: 1_062_168, cacheRead: 824_213_120, cacheCreation: 0, reasoning: 785_397 }
    const estimated = { model: 'gpt-6-astra-fast', tokens, costUSD: 0 }
    const recorded = { model: 'gpt-6-astra-fast', tokens, costUSD: 123 }
    await enrichCosts([estimated, recorded])
    expect(estimated.costUSD).toBeCloseTo(2000.82424)
    expect(recorded.costUSD).toBe(123)
  })
})
