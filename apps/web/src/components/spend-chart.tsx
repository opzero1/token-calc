import type { Source } from '@token-calc/core'
import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { monotonePath, niceMax, useElementWidth } from '@/lib/chart'
import { formatCompactTokens, formatUsd, SOURCE_COLORS, SOURCE_LABELS, totalTokens } from '@/lib/format'
import type { WebSnapshot } from '@/lib/snapshot'
import { cn } from '@/lib/utils'

type Metric = 'cost' | 'tokens'

type ChartDay = {
  date: string
  total: number
  average: number
  bySource: Partial<Record<Source, number>>
}

const DAY_MS = 24 * 60 * 60 * 1000
const HEIGHT = 300
const PADDING = { top: 18, right: 18, bottom: 30, left: 58 }

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function formatDay(key: string, withYear = false) {
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  })
}

function formatValue(metric: Metric, value: number, compact = false) {
  return metric === 'cost' ? formatUsd(value, compact) : formatCompactTokens(value)
}

function formatAxis(metric: Metric, value: number) {
  if (metric === 'tokens') return formatCompactTokens(value)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 || (value > 0 && value < 10) ? 2 : 0,
  }).format(value)
}

function rollingAverage(values: number[]) {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - 6), index + 1)
    return window.reduce((sum, value) => sum + value, 0) / window.length
  })
}

function buildDays(snapshot: WebSnapshot, metric: Metric): ChartDay[] {
  const today = new Date(`${snapshot.generated.slice(0, 10)}T00:00:00.000Z`)
  const firstActive = snapshot.daily[0]?.date
  const windowDays = snapshot.range === 'all' ? 30 : Number(snapshot.range)
  const windowStart = new Date(today.getTime() - (windowDays - 1) * DAY_MS)
  const start =
    firstActive && firstActive < dateKey(windowStart) ? new Date(`${firstActive}T00:00:00.000Z`) : windowStart

  const valueOf = (item: { costUSD: number; tokens: WebSnapshot['totals']['tokens'] }) =>
    metric === 'cost' ? item.costUSD : totalTokens(item.tokens)
  const dailyByDate = new Map(snapshot.daily.map((day) => [day.date, valueOf(day)]))
  const sourcesByDate = new Map<string, Partial<Record<Source, number>>>()
  for (const item of snapshot.dailyBySource) {
    const entry = sourcesByDate.get(item.date) ?? {}
    entry[item.source] = valueOf(item)
    sourcesByDate.set(item.date, entry)
  }

  const days: ChartDay[] = []
  for (let cursor = start; cursor <= today; cursor = new Date(cursor.getTime() + DAY_MS)) {
    const key = dateKey(cursor)
    days.push({ date: key, total: dailyByDate.get(key) ?? 0, average: 0, bySource: sourcesByDate.get(key) ?? {} })
  }
  rollingAverage(days.map((day) => day.total)).forEach((average, index) => {
    days[index].average = average
  })
  return days
}

export function SpendChart({ snapshot }: { snapshot: WebSnapshot }) {
  const [metric, setMetric] = React.useState<Metric>('cost')
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null)
  const [containerRef, width] = useElementWidth<HTMLDivElement>()
  const days = React.useMemo(() => buildDays(snapshot, metric), [snapshot, metric])
  const sources = snapshot.bySource.map((item) => item.source)
  const smooth = days.length > 45
  const showAverage = days.length > 14

  const plotWidth = Math.max(0, width - PADDING.left - PADDING.right)
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
  const maxValue = niceMax(Math.max(...days.map((day) => day.total), 0))
  const x = (index: number) => PADDING.left + (days.length <= 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth)
  const y = (value: number) => PADDING.top + plotHeight - (value / maxValue) * plotHeight
  const linePath = (values: number[]) => monotonePath(values.map((value, index) => [x(index), y(value)]))

  const primary = days.map((day) => (smooth ? day.average : day.total))
  const primaryPath = linePath(primary)
  const areaPath = days.length ? `${primaryPath}L${x(days.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : ''
  const secondaryPath = linePath(days.map((day) => (smooth ? day.total : day.average)))
  const sourcePaths =
    sources.length > 1
      ? sources.map((source) => {
          const daily = days.map((day) => day.bySource[source] ?? 0)
          const values = smooth ? rollingAverage(daily) : daily
          return { source, values, path: linePath(values) }
        })
      : []

  const peakIndex = days.reduce((best, day, index) => (day.total > days[best].total ? index : best), 0)
  const peak = days[peakIndex]
  const activeDays = days.filter((day) => day.total > 0).length
  const rangeTotal = days.reduce((sum, day) => sum + day.total, 0)
  const spansYears = days.length > 0 && days[0].date.slice(0, 4) !== days[days.length - 1].date.slice(0, 4)
  const tickCount = Math.min(days.length, Math.max(2, Math.floor(plotWidth / 110)))
  const ticks = Array.from(new Set(
    Array.from({ length: tickCount }, (_, index) => Math.round((index / Math.max(1, tickCount - 1)) * (days.length - 1))),
  ))
  const hovered = hoverIndex === null ? null : days[hoverIndex]

  function handlePointerMove(event: React.PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width)
    setHoverIndex(Math.min(days.length - 1, Math.max(0, Math.round(ratio * (days.length - 1)))))
  }

  return (
    <Card>
      <CardHeader className="gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">01 / Velocity</div>
          <CardTitle className="mt-2 text-2xl sm:text-3xl">{metric === 'cost' ? 'Daily spend' : 'Daily tokens'}</CardTitle>
          <CardDescription className="mt-1">
            {metric === 'cost' ? 'Estimated cost' : 'Token volume'} per UTC day
            {smooth ? ', smoothed to a 7-day average. The faint line shows each day.' : ', with each tool traced underneath.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-3 lg:justify-end">
          <ChartStat label="Window total" value={formatValue(metric, rangeTotal, true)} />
          <ChartStat
            label="Peak day"
            value={peak && peak.total > 0 ? formatValue(metric, peak.total, true) : '—'}
            detail={peak && peak.total > 0 ? formatDay(peak.date) : undefined}
          />
          <ChartStat label="Per active day" value={formatValue(metric, activeDays ? rangeTotal / activeDays : 0, true)} />
          <TabsList aria-label="Chart metric">
            <TabsTrigger active={metric === 'cost'} onClick={() => setMetric('cost')}>
              Spend
            </TabsTrigger>
            <TabsTrigger active={metric === 'tokens'} onClick={() => setMetric('tokens')}>
              Tokens
            </TabsTrigger>
          </TabsList>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-muted-foreground">
          <LegendItem color="var(--main)" label={smooth ? 'All tools, 7-day average' : 'All tools'} thick />
          {smooth ? <LegendItem color="rgba(217,255,99,0.4)" label="Daily total" /> : null}
          {sourcePaths.map(({ source }) => (
            <LegendItem key={source} color={SOURCE_COLORS[source]} label={SOURCE_LABELS[source]} />
          ))}
          {showAverage && !smooth ? <LegendItem color="rgba(244,244,239,0.7)" label="7-day average" dashed /> : null}
        </div>
        <div ref={containerRef} className="relative h-[300px] w-full">
          {width > 0 ? (
            <svg width={width} height={HEIGHT} role="img" aria-label={`${metric === 'cost' ? 'Daily spend' : 'Daily tokens'} line chart`}>
              <defs>
                <linearGradient id="spend-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--main)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--main)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
                <g key={fraction}>
                  <line
                    x1={PADDING.left}
                    x2={width - PADDING.right}
                    y1={y(maxValue * fraction)}
                    y2={y(maxValue * fraction)}
                    stroke="rgba(255,255,255,0.07)"
                    strokeDasharray={fraction === 0 ? undefined : '3 5'}
                  />
                  <text
                    x={PADDING.left - 12}
                    y={y(maxValue * fraction)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted-foreground font-heading text-[10px] tabular-nums"
                  >
                    {formatAxis(metric, maxValue * fraction)}
                  </text>
                </g>
              ))}
              {ticks.map((index) => (
                <text
                  key={index}
                  x={x(index)}
                  y={HEIGHT - 8}
                  textAnchor={index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle'}
                  className="fill-muted-foreground text-[10px] font-semibold"
                >
                  {formatDay(days[index].date, spansYears)}
                </text>
              ))}
              <g key={`${snapshot.range}:${metric}`} className="chart-reveal">
                <path d={areaPath} fill="url(#spend-area)" />
                {smooth ? (
                  <path d={secondaryPath} fill="none" stroke="var(--main)" strokeOpacity={0.3} strokeWidth={1} />
                ) : null}
                {sourcePaths.map(({ source, path }) => (
                  <path
                    key={source}
                    d={path}
                    fill="none"
                    stroke={SOURCE_COLORS[source]}
                    strokeOpacity={hovered ? 0.95 : 0.7}
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                  />
                ))}
                {showAverage && !smooth ? (
                  <path d={secondaryPath} fill="none" stroke="rgba(244,244,239,0.7)" strokeWidth={1.4} strokeDasharray="5 5" />
                ) : null}
                <path
                  d={primaryPath}
                  fill="none"
                  stroke="var(--main)"
                  strokeWidth={2.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(217,255,99,0.35))' }}
                />
                {peak && peak.total > 0 && hoverIndex === null ? (
                  <g>
                    <circle cx={x(peakIndex)} cy={y(peak.total)} r={9} fill="var(--main)" fillOpacity={0.14} />
                    <circle cx={x(peakIndex)} cy={y(peak.total)} r={3.5} fill="var(--main)" />
                  </g>
                ) : null}
              </g>
              {hovered && hoverIndex !== null ? (
                <g pointerEvents="none">
                  <line
                    x1={x(hoverIndex)}
                    x2={x(hoverIndex)}
                    y1={PADDING.top}
                    y2={y(0)}
                    stroke="rgba(255,255,255,0.28)"
                  />
                  {sourcePaths.map(({ source, values }) => (
                    <circle
                      key={source}
                      cx={x(hoverIndex)}
                      cy={y(values[hoverIndex])}
                      r={3}
                      fill={SOURCE_COLORS[source]}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                    />
                  ))}
                  {smooth ? <circle cx={x(hoverIndex)} cy={y(hovered.total)} r={3} fill="var(--main)" fillOpacity={0.6} /> : null}
                  <circle cx={x(hoverIndex)} cy={y(primary[hoverIndex])} r={4.5} fill="var(--main)" stroke="var(--background)" strokeWidth={2} />
                </g>
              ) : null}
              <rect
                x={PADDING.left}
                y={PADDING.top}
                width={plotWidth}
                height={plotHeight}
                fill="transparent"
                onPointerMove={handlePointerMove}
                onPointerLeave={() => setHoverIndex(null)}
              />
            </svg>
          ) : null}
          {hovered && hoverIndex !== null ? (
            <ChartTooltip
              day={hovered}
              metric={metric}
              sources={sources}
              showAverage={showAverage}
              left={x(hoverIndex)}
              flip={x(hoverIndex) > width * 0.62}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ChartStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-24 rounded-xl border border-border bg-black/15 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-heading text-base font-medium tabular-nums">
        {value}
        {detail ? <span className="ml-1.5 text-[11px] text-muted-foreground">{detail}</span> : null}
      </div>
    </div>
  )
}

function LegendItem({ color, label, thick, dashed }: { color: string; label: string; thick?: boolean; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn('w-4 rounded-full', thick ? 'h-[3px]' : 'h-[2px]')}
        style={
          dashed
            ? { backgroundImage: `linear-gradient(90deg, ${color} 55%, transparent 55%)`, backgroundSize: '6px 100%' }
            : { backgroundColor: color }
        }
      />
      {label}
    </span>
  )
}

function ChartTooltip({
  day,
  metric,
  sources,
  showAverage,
  left,
  flip,
}: {
  day: ChartDay
  metric: Metric
  sources: Source[]
  showAverage: boolean
  left: number
  flip: boolean
}) {
  const rows = sources
    .map((source) => ({ source, value: day.bySource[source] ?? 0 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)

  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-48 rounded-xl border border-white/15 bg-[#0d0e12]/95 px-3.5 py-3 shadow-shadow backdrop-blur-md"
      style={flip ? { right: `calc(100% - ${left - 14}px)` } : { left: left + 14 }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
        {new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })}
      </div>
      <div className="mt-1.5 font-heading text-xl font-medium tabular-nums text-main">{formatValue(metric, day.total)}</div>
      {rows.length > 0 ? (
        <div className="mt-2 grid gap-1 border-t border-border pt-2">
          {rows.map((row) => (
            <div key={row.source} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[row.source] }} />
                {SOURCE_LABELS[row.source]}
              </span>
              <span className="font-heading tabular-nums">{formatValue(metric, row.value)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">No recorded usage</div>
      )}
      {showAverage ? (
        <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-2 text-xs text-muted-foreground">
          <span>7-day average</span>
          <span className="font-heading tabular-nums text-foreground">{formatValue(metric, day.average)}</span>
        </div>
      ) : null}
    </div>
  )
}
