import { parseArgs } from 'node:util'
import type { TimeRange } from '@token-calc/core'

type Period = { kind: 'range'; range: TimeRange } | { kind: 'date'; date: string } | { kind: 'since'; date: string }

export function parseCliArgs(args: string[]): { period: Period; showCost: boolean } {
  const { values, positionals } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: {
      range: { type: 'string' },
      date: { type: 'string' },
      since: { type: 'string' },
      'no-cost': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })

  if (positionals.length > 1 || (values.range !== undefined && positionals.length > 0)) {
    throw new Error('Specify one of --range, --date YYYY-MM-DD, or --since YYYY-MM-DD.')
  }

  const range = values.range ?? positionals[0]
  return { period: parsePeriod(range, values.date, values.since), showCost: !values['no-cost'] }
}

function parsePeriod(range: string | undefined, dateValue: string | undefined, since: string | undefined): Period {
  if ([range, dateValue, since].filter((value) => value !== undefined).length > 1) {
    throw new Error('Use only one of --date, --since, or --range.')
  }
  const selectedDate = dateValue ?? since
  if (selectedDate !== undefined) {
    const date = new Date(`${selectedDate}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== selectedDate
    ) {
      throw new Error('Invalid date. Use a calendar date in YYYY-MM-DD format, for example 2026-09-08.')
    }
    return { kind: dateValue !== undefined ? 'date' : 'since', date: selectedDate }
  }

  switch (range) {
    case undefined:
      return { kind: 'range', range: '90' }
    case '7':
    case '30':
    case '90':
    case '180':
    case '365':
    case 'all':
      return { kind: 'range', range }
    default:
      throw new Error('Invalid range. Choose 7, 30, 90, 180, 365, or all.')
  }
}
