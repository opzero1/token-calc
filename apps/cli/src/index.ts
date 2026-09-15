#!/usr/bin/env bun

import { Box, ScrollBox, Text, createCliRenderer } from '@opentui/core'
import { loadDailySnapshot, loadDashboardSnapshot, type DashboardData } from '@token-calc/core'
import { parsePeriod } from './args.js'

const SOURCE_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  amp: 'Amp',
  pi: 'Pi-Agent',
}

const THEME = {
  background: '#101014',
  panel: '#181820',
  panelAlt: '#20202a',
  border: '#4b5563',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#38bdf8',
  header: '#f97316',
  danger: '#fb7185',
}

function wantsHelp(args: string[]) {
  return args.includes('--help') || args.includes('-h')
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { notation: value >= 1_000_000 ? 'compact' : 'standard' }).format(value)
}

function formatUsd(value: number, compact = false) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact && value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

function totalTokens(tokens: DashboardData['totals']['tokens']) {
  return tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead + tokens.reasoning
}

function shortModel(model: string) {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/^\[pi\]\s*/, '')
}

function bar(value: number, max: number, width = 28) {
  const filled = Math.max(0, Math.round((value / Math.max(1, max)) * width))
  return `${'#'.repeat(filled)}${'.'.repeat(Math.max(0, width - filled))}`
}

function metric(label: string, value: string) {
  return Box(
    {
      border: true,
      borderStyle: 'single',
      borderColor: THEME.border,
      paddingX: 1,
      paddingY: 0,
      width: '19%',
      minWidth: 18,
      height: 5,
      flexDirection: 'column',
      backgroundColor: THEME.panelAlt,
    },
    Text({ content: label.toUpperCase(), fg: THEME.muted }),
    Text({ content: value, fg: THEME.text }),
  )
}

function modelCostRows(snapshot: DashboardData, limit: number) {
  const models = snapshot.byModel.slice(0, limit)
  const maxCost = Math.max(1, ...models.map((model) => model.costUSD))

  return models
    .map((model, index) => {
      const rank = String(index + 1).padStart(2, ' ')
      const name = shortModel(model.model).padEnd(34, ' ').slice(0, 34)
      const cost = formatUsd(model.costUSD).padStart(12, ' ')
      return `${rank}. ${name} ${cost}  ${bar(model.costUSD, maxCost)}`
    })
    .join('\n')
}

function modelTokenRows(snapshot: DashboardData, limit: number) {
  const models = [...snapshot.byModel].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens)).slice(0, limit)

  return models
    .map((model, index) => {
      const tokens = model.tokens
      return [
        `${String(index + 1).padStart(2, ' ')}. ${shortModel(model.model)}  ${formatNumber(totalTokens(tokens))} tokens  ${formatUsd(model.costUSD)}`,
        `    in ${formatNumber(tokens.input)} | out ${formatNumber(tokens.output)} | cache write ${formatNumber(tokens.cacheCreation)} | cache read ${formatNumber(tokens.cacheRead)} | reasoning ${formatNumber(tokens.reasoning)}`,
      ].join('\n')
    })
    .join('\n')
}

function sourceRows(snapshot: DashboardData) {
  const maxCost = Math.max(1, ...snapshot.bySource.map((source) => source.costUSD))

  return snapshot.bySource
    .map((source) => {
      const label = (SOURCE_LABELS[source.source] ?? source.source).padEnd(16, ' ')
      return `${label} ${formatUsd(source.costUSD).padStart(12, ' ')}  ${bar(source.costUSD, maxCost, 24)}  ${formatNumber(totalTokens(source.tokens))} tokens`
    })
    .join('\n')
}

function recentDailyRows(snapshot: DashboardData) {
  return snapshot.daily
    .slice(-10)
    .reverse()
    .map((day) => `${day.date}  ${formatUsd(day.costUSD).padStart(12, ' ')}  ${formatNumber(totalTokens(day.tokens)).padStart(10, ' ')} tokens  ${day.models.map(shortModel).slice(0, 3).join(', ')}`)
    .join('\n')
}

function helpText() {
  return [
    'token-calc-tui',
    '',
    'Usage:',
    '  pnpm --filter @token-calc/cli dev -- --range 30',
    '  pnpm --filter @token-calc/cli dev -- --date 2026-09-08',
    '  bun apps/cli/src/index.ts --range all',
    '',
    'Ranges: 7, 30, 90, 180, 365, all',
    'Date: YYYY-MM-DD, midnight to midnight UTC. Use either --date or --range.',
    '',
    'OpenTUI currently runs through Bun. Press q or Ctrl+C to exit.',
  ].join('\n')
}

async function main() {
  const args = Bun.argv.slice(2)
  if (wantsHelp(args)) {
    console.log(helpText())
    return
  }

  const period = parsePeriod(args)
  const snapshot = await (period.kind === 'date' ? loadDailySnapshot(period.date) : loadDashboardSnapshot(period.range))
  const periodLabel = period.kind === 'date' ? `Date ${period.date} (UTC)` : `Range ${period.range.toUpperCase()}`
  const modelLimit = period.kind === 'date' ? snapshot.byModel.length : 8
  const modelsLabel = period.kind === 'date' ? 'Models' : 'Top Models'
  const generated = new Date(snapshot.generated).toLocaleString()
  const averageCost = snapshot.totals.activeDays > 0 ? snapshot.totals.costUSD / snapshot.totals.activeDays : 0

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 8,
    maxFps: 12,
    backgroundColor: THEME.background,
  })

  renderer.keyInput.on('keypress', (key) => {
    if (key.name.toLowerCase() !== 'q' || key.ctrl || key.meta) return
    key.preventDefault()
    renderer.destroy()
    process.exit(0)
  })

  renderer.root.add(
    Box(
      {
        flexDirection: 'column',
        gap: 1,
        padding: 1,
        width: '100%',
        height: '100%',
        backgroundColor: THEME.background,
      },
      Box(
        {
          border: true,
          borderStyle: 'single',
          borderColor: THEME.border,
          paddingX: 1,
          paddingY: 0,
          backgroundColor: THEME.panel,
          flexDirection: 'column',
          flexShrink: 0,
        },
        Text({ content: 'token-calc', fg: THEME.header }),
        Text({ content: `${periodLabel} | generated ${generated} | press q or Ctrl+C to exit`, fg: THEME.muted }),
      ),
      Box(
        {
          flexDirection: 'row',
          gap: 1,
          flexWrap: 'wrap',
          width: '100%',
        },
        metric('Total Cost', formatUsd(snapshot.totals.costUSD)),
        metric('Total Tokens', formatNumber(snapshot.totals.totalTokens)),
        metric('Active Days', formatNumber(snapshot.totals.activeDays)),
        metric('Cost / Day', formatUsd(averageCost)),
        metric('Events', formatNumber(snapshot.totals.eventCount)),
      ),
      ScrollBox(
        {
          border: true,
          borderStyle: 'single',
          borderColor: THEME.border,
          padding: 1,
          flexGrow: 1,
          width: '100%',
          backgroundColor: THEME.panel,
        },
        snapshot.totals.eventCount === 0
          ? Text({ content: `No usage found for ${periodLabel.toLowerCase()}.\n`, fg: THEME.muted })
          : Text({ content: '', fg: THEME.text }),
        Text({ content: `${modelsLabel} by Cost\n${modelCostRows(snapshot, modelLimit)}`, fg: THEME.text }),
        Text({ content: `\n${modelsLabel} by Token Usage\n${modelTokenRows(snapshot, modelLimit)}`, fg: THEME.text }),
        Text({ content: `\nSources\n${sourceRows(snapshot)}`, fg: THEME.text }),
        Text({ content: `\n${period.kind === 'date' ? 'Day Summary' : 'Recent Days'}\n${recentDailyRows(snapshot)}`, fg: THEME.text }),
        snapshot.errors.length > 0
          ? Text({
              content: `\nLoader Errors\n${snapshot.errors.map((error) => `${SOURCE_LABELS[error.source] ?? error.source}: ${error.error}`).join('\n')}`,
              fg: THEME.danger,
            })
          : Text({ content: '', fg: THEME.text }),
      ),
    ),
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
