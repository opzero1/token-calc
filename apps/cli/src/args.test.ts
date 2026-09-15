import { describe, expect, it } from 'vitest'
import { parsePeriod } from './args.js'

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

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-9-8', 'today', '2026-09-08T00:00:00Z', ''])(
    'rejects invalid dates instead of loading a default range: %s',
    (date) => expect(() => parsePeriod(['--date', date])).toThrow('Invalid date'),
  )

  it.each([
    ['--date'],
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
})
