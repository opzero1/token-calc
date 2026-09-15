import { parseArgs } from 'node:util'
import type { TimeRange } from '@token-calc/core'

type Period = { kind: 'range'; range: TimeRange } | { kind: 'date'; date: string }

export function parsePeriod(args: string[]): Period {
  const { values, positionals } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options: { range: { type: 'string' }, date: { type: 'string' } },
    allowPositionals: true,
  })

  if (positionals.length > 1 || (values.range !== undefined && positionals.length > 0)) {
    throw new Error('Specify one range or --date YYYY-MM-DD.')
  }

  const range = values.range ?? positionals[0]
  if (values.date !== undefined) {
    if (range !== undefined) throw new Error('Use --date or --range, not both.')
    const date = new Date(`${values.date}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(values.date) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== values.date
    ) {
      throw new Error('Invalid date. Use a calendar date in YYYY-MM-DD format, for example 2026-09-08.')
    }
    return { kind: 'date', date: values.date }
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
