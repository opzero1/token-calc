import type { TokenCounts } from './types.js'

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

type ModelPricing = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_creation_input_token_cost?: number
  cache_read_input_token_cost?: number
}

const FALLBACK_PRICES: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  'claude-opus-4-20250514': {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  'gpt-5': {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 8e-6,
    cache_read_input_token_cost: 0.5e-6,
  },
  'gpt-6-astra': {
    input_cost_per_token: 10e-6,
    output_cost_per_token: 50e-6,
    cache_read_input_token_cost: 1e-6,
    cache_creation_input_token_cost: 12.5e-6,
  },
}

let pricingCache: Record<string, ModelPricing> | null = null
let pricingInFlight: Promise<Record<string, ModelPricing>> | null = null

async function fetchPricing(): Promise<Record<string, ModelPricing>> {
  if (pricingCache) return pricingCache
  if (pricingInFlight) return pricingInFlight
  pricingInFlight = loadPricing()
  try {
    return await pricingInFlight
  } finally {
    pricingInFlight = null
  }
}

async function loadPricing(): Promise<Record<string, ModelPricing>> {
  try {
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    pricingCache = (await res.json()) as Record<string, ModelPricing>
    return pricingCache
  } catch {
    pricingCache = FALLBACK_PRICES
    return pricingCache
  }
}

function findModelPricing(prices: Record<string, ModelPricing>, modelName: string): ModelPricing | null {
  if (prices[modelName]) return prices[modelName]

  const prefixes = ['anthropic/', 'openai/', 'openrouter/openai/', '']
  for (const prefix of prefixes) {
    const key = prefix + modelName
    if (prices[key]) return prices[key]
  }

  const cleaned = modelName.replace(/^\[pi\]\s*/, '')
  if (cleaned !== modelName) return findModelPricing(prices, cleaned)

  const baseMatch = modelName.replace(/-\d{8}$/, '')
  if (baseMatch !== modelName) return findModelPricing(prices, baseMatch)

  for (const key of Object.keys(prices)) {
    if (key.includes(modelName) || modelName.includes(key.replace(/^[^/]+\//, ''))) {
      return prices[key]
    }
  }

  return null
}

function modelCalculator(prices: Record<string, ModelPricing>, model: string): (tokens: TokenCounts) => number {
  const isAstraFast = model.replace(/^\[pi\]\s*/, '').replace(/^(?:openrouter\/)?openai\//, '') === 'gpt-6-astra-fast'
  const pricing = findModelPricing(prices, isAstraFast ? 'gpt-6-astra' : model)
  if (!pricing) return () => 0

  return (tokens) => {
    const inputCost = tokens.input * (pricing.input_cost_per_token ?? 0)
    const outputCost = (tokens.output + tokens.reasoning) * (pricing.output_cost_per_token ?? 0)
    const cacheCreateCost =
      tokens.cacheCreation * (pricing.cache_creation_input_token_cost ?? pricing.input_cost_per_token ?? 0)
    const cacheReadCost = tokens.cacheRead * (pricing.cache_read_input_token_cost ?? pricing.input_cost_per_token ?? 0)

    return (inputCost + outputCost + cacheCreateCost + cacheReadCost) * (isAstraFast ? 2 : 1)
  }
}

export async function calculateCost(model: string, tokens: TokenCounts): Promise<number> {
  return modelCalculator(await fetchPricing(), model)(tokens)
}

export async function enrichCosts(
  events: Array<{ model: string; tokens: TokenCounts; costUSD: number }>,
): Promise<void> {
  const prices = await fetchPricing()
  const byModel = new Map<string, (tokens: TokenCounts) => number>()
  for (const event of events) {
    if (event.costUSD > 0) continue
    let calculate = byModel.get(event.model)
    if (!calculate) {
      calculate = modelCalculator(prices, event.model)
      byModel.set(event.model, calculate)
    }
    event.costUSD = calculate(event.tokens)
  }
}
