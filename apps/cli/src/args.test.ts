import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './args.js'

const parsePeriod = (args: string[]) => parseCliArgs(args).period

describe('CLI period selection', () => {
  it.each([
    ['--date', '2026-09-08'],
    ['--date=2026-09-08'],
    ['--', '--date', '2026-09-08'],
  ])('accepts a specific date: %j', (...args) => {
    expect(parsePeriod(args)).toEqual({ kind: 'date', date: '2026-09-08' })
  })

  it('accepts leap days', () => {
    expect(parsePeriod(['--date', '2024-02-29'])).toEqual({ kind: 'date', date: '2024-02-29' })
  })

  it('accepts a start date through now', () => {
    expect(parsePeriod(['--since', '2026-09-01'])).toEqual({ kind: 'since', date: '2026-09-01' })
    expect(parsePeriod(['--', '--since=2026-09-01'])).toEqual({ kind: 'since', date: '2026-09-01' })
    expect(() => parsePeriod(['--since', '2026-02-29'])).toThrow('Invalid date')
  })

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-9-8', 'today', '2026-09-08T00:00:00Z', ''])(
    'rejects invalid dates instead of loading a default range: %s',
    (date) => expect(() => parsePeriod(['--date', date])).toThrow('Invalid date'),
  )

  it.each([
    ['--date'],
    ['--since'],
    ['--since', '2026-09-01', '--date', '2026-09-08'],
    ['--since', '2026-09-01', '--range', '30'],
    ['30', '--since', '2026-09-01'],
    ['--date', '2026-09-08', '--range', '30'],
    ['30', '--date', '2026-09-08'],
    ['--range', '30', '90'],
    ['--range', 'bogus'],
    ['--data', '2026-09-08'],
  ])('rejects missing, conflicting, or unknown arguments: %j', (...args) => {
    expect(() => parsePeriod(args)).toThrow()
  })

  it('keeps the default and existing range syntax', () => {
    expect(parsePeriod([])).toEqual({ kind: 'range', range: '90' })
    for (const range of ['7', '30', '90', '180', '365', 'all']) {
      for (const args of [[range], ['--range', range], [`--range=${range}`], ['--', '--range', range]]) {
        expect(parsePeriod(args)).toEqual({ kind: 'range', range })
      }
    }
  })

  it.each([[], ['--range', '30'], ['--date', '2026-09-08'], ['--since', '2026-09-01'], ['30']])(
    'allows hiding cost without changing the selected period: %j',
    (...args) => {
      const defaults = parseCliArgs(args)
      expect(defaults.showCost).toBe(true)
      expect(parseCliArgs(['--', ...args, '--no-cost'])).toEqual({ ...defaults, showCost: false })
    },
  )
})
