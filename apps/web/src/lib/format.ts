import type { Source, TimeRange, TokenCounts } from '@token-calc/core'

export const SOURCE_LABELS: Record<Source, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  amp: 'Amp',
  pi: 'Pi-Agent',
}

export const SOURCE_COLORS: Record<Source, string> = {
  'claude-code': '#f97360',
  codex: '#2dd4bf',
  gemini: '#60a5fa',
  opencode: '#a78bfa',
  amp: '#fbbf24',
  pi: '#f472b6',
}

export const RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '180D' },
  { value: '365', label: '1Y' },
  { value: 'all', label: 'ALL' },
]

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
  }).format(value)
}

export function formatCompactTokens(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatUsd(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact && value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

export function totalTokens(tokens: TokenCounts) {
  return tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead + tokens.reasoning
}

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}
