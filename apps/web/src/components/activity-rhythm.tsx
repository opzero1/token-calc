import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatCompactTokens, formatHour, formatNumber, formatUsd } from '@/lib/format'
import type { WebSnapshot } from '@/lib/snapshot'
import { cn } from '@/lib/utils'

type Metric = 'tokens' | 'cost'

const WEEKDAYS = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 0, short: 'Sun', long: 'Sunday' },
]
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4, 5])

type Cell = { value: number; costUSD: number; totalTokens: number; eventCount: number }

function share(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : '0%'
}

function indexOfMax(values: number[]) {
  return values.reduce((best, value, index) => (value > values[best] ? index : best), 0)
}

export function ActivityRhythm({ snapshot }: { snapshot: WebSnapshot }) {
  const [metric, setMetric] = React.useState<Metric>('tokens')
  const [hovered, setHovered] = React.useState<{ row: number; hour: number } | null>(null)
  const timeZone = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const { grid, hourTotals, dayTotals, total, max } = React.useMemo(() => {
    const byKey = new Map(snapshot.byWeekdayHour.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]))
    const grid: Cell[][] = WEEKDAYS.map(({ day }) =>
      HOURS.map((hour) => {
        const cell = byKey.get(`${day}:${hour}`)
        const costUSD = cell?.costUSD ?? 0
        const totalTokens = cell?.totalTokens ?? 0
        return { value: metric === 'cost' ? costUSD : totalTokens, costUSD, totalTokens, eventCount: cell?.eventCount ?? 0 }
      }),
    )
    const hourTotals = HOURS.map((hour) => grid.reduce((sum, row) => sum + row[hour].value, 0))
    const dayTotals = grid.map((row) => row.reduce((sum, cell) => sum + cell.value, 0))
    return {
      grid,
      hourTotals,
      dayTotals,
      total: dayTotals.reduce((sum, value) => sum + value, 0),
      max: Math.max(0, ...grid.flat().map((cell) => cell.value)),
    }
  }, [snapshot.byWeekdayHour, metric])

  const format = (value: number) => (metric === 'cost' ? formatUsd(value, true) : formatCompactTokens(value))
  const peakHour = indexOfMax(hourTotals)
  const peakDay = indexOfMax(dayTotals)
  const nightTotal = HOURS.filter((hour) => NIGHT_HOURS.has(hour)).reduce((sum, hour) => sum + hourTotals[hour], 0)
  const weekendTotal = dayTotals[5] + dayTotals[6]
  const maxHour = Math.max(1e-9, ...hourTotals)
  const maxDay = Math.max(1e-9, ...dayTotals)
  const peakSlot = grid.flatMap((row, rowIndex) => row.map((cell, hour) => ({ cell, rowIndex, hour }))).reduce(
    (best, item) => (item.cell.value > best.cell.value ? item : best),
  )
  const focus = hovered ?? (peakSlot.cell.value > 0 ? { row: peakSlot.rowIndex, hour: peakSlot.hour } : null)
  const focusCell = focus ? grid[focus.row][focus.hour] : null

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow">02 / Rhythm</div>
          <CardTitle className="mt-2 text-2xl">When your agents work</CardTitle>
          <CardDescription className="mt-1">Weekday and hour of day, in your local time ({timeZone}).</CardDescription>
        </div>
        <TabsList aria-label="Rhythm metric">
          <TabsTrigger active={metric === 'cost'} onClick={() => setMetric('cost')}>
            Spend
          </TabsTrigger>
          <TabsTrigger active={metric === 'tokens'} onClick={() => setMetric('tokens')}>
            Tokens
          </TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <Insight
            label="Peak hour"
            value={total > 0 ? `${formatHour(peakHour)}–${formatHour((peakHour + 1) % 24)}` : '—'}
            detail={`${share(hourTotals[peakHour], total)} of volume, all days`}
          />
          <Insight label="Busiest day" value={total > 0 ? WEEKDAYS[peakDay].long : '—'} detail={`${share(dayTotals[peakDay], total)} of volume`} />
          <Insight label="After dark" value={share(nightTotal, total)} detail="22:00 to 06:00" />
          <Insight label="Weekends" value={share(weekendTotal, total)} detail="Saturday and Sunday" />
        </div>

        <div className="overflow-x-auto pb-1">
          <div
            className="grid min-w-[620px] items-center gap-[3px]"
            style={{ gridTemplateColumns: '2.4rem repeat(24, minmax(0, 1fr)) 4.75rem' }}
            onMouseLeave={() => setHovered(null)}
          >
            <span />
            {HOURS.map((hour) => (
              <div key={hour} className="flex h-12 items-end">
                <div
                  className={cn(
                    'bar-rise w-full rounded-t-[3px] transition-[height,background-color] duration-300',
                    focus?.hour === hour ? 'bg-main' : 'bg-main/35',
                  )}
                  style={{
                    height: `${Math.max(hourTotals[hour] > 0 ? 6 : 2, (hourTotals[hour] / maxHour) * 100)}%`,
                    animationDelay: `${150 + hour * 18}ms`,
                  }}
                  title={`${formatHour(hour)}: ${format(hourTotals[hour])}`}
                />
              </div>
            ))}
            <span />

            {grid.map((row, rowIndex) => (
              <React.Fragment key={WEEKDAYS[rowIndex].day}>
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors',
                    focus?.row === rowIndex && 'text-foreground',
                  )}
                >
                  {WEEKDAYS[rowIndex].short}
                </span>
                {row.map((cell, hour) => {
                  const intensity = max > 0 ? Math.sqrt(cell.value / max) : 0
                  const isFocus = focus?.row === rowIndex && focus.hour === hour
                  const inCross = focus?.row === rowIndex || focus?.hour === hour
                  return (
                    <button
                      key={hour}
                      type="button"
                      aria-label={`${WEEKDAYS[rowIndex].long} ${formatHour(hour)}: ${format(cell.value)}`}
                      className={cn(
                        'relative grid aspect-square place-items-center rounded-[5px] border border-transparent bg-white/[0.025] outline-none transition-colors',
                        inCross && 'bg-white/[0.06]',
                        isFocus && 'border-white/40',
                      )}
                      onMouseEnter={() => setHovered({ row: rowIndex, hour })}
                      onFocus={() => setHovered({ row: rowIndex, hour })}
                    >
                      <span
                        className="bubble-in block rounded-full transition-[width,height,opacity] duration-300"
                        style={{
                          animationDelay: `${200 + (rowIndex + hour) * 14}ms`,
                          width: cell.value > 0 ? `${22 + intensity * 70}%` : '14%',
                          height: cell.value > 0 ? `${22 + intensity * 70}%` : '14%',
                          backgroundColor: cell.value > 0 ? 'var(--main)' : 'rgba(255,255,255,0.12)',
                          opacity: cell.value > 0 ? 0.28 + intensity * 0.72 : 1,
                          boxShadow: intensity > 0.75 ? '0 0 14px rgba(217,255,99,0.45)' : undefined,
                        }}
                      />
                    </button>
                  )
                })}
                <div className="flex items-center gap-2 pl-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={cn(
                        'bar-grow h-full rounded-full transition-[width] duration-300',
                        focus?.row === rowIndex ? 'bg-main' : 'bg-main/45',
                      )}
                      style={{ width: `${(dayTotals[rowIndex] / maxDay) * 100}%`, animationDelay: `${300 + rowIndex * 60}ms` }}
                    />
                  </div>
                </div>
              </React.Fragment>
            ))}

            <span />
            {HOURS.map((hour) => (
              <span
                key={hour}
                className={cn(
                  'pt-1 text-center text-[9px] font-semibold tabular-nums text-muted-foreground',
                  focus?.hour === hour && 'text-foreground',
                )}
              >
                {hour % 3 === 0 || focus?.hour === hour ? String(hour).padStart(2, '0') : ''}
              </span>
            ))}
            <span />
          </div>
        </div>

        <div className="mt-auto flex min-h-[52px] flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-black/15 px-4 py-3">
          {focus && focusCell ? (
            <>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {hovered ? 'Selected slot' : 'Hottest slot'}
                </div>
                <div className="mt-1 font-heading text-sm font-medium">
                  {WEEKDAYS[focus.row].long}, {formatHour(focus.hour)}–{formatHour((focus.hour + 1) % 24)}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 font-heading text-sm tabular-nums">
                <span>{formatCompactTokens(focusCell.totalTokens)} tokens</span>
                <span>{formatUsd(focusCell.costUSD)}</span>
                <span className="text-muted-foreground">{formatNumber(focusCell.eventCount)} requests</span>
                <span className="text-main">{share(focusCell.value, total)}</span>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">No activity in this window yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Insight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.025] px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 truncate font-heading text-lg font-medium tracking-[-0.03em]">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
    </div>
  )
}
