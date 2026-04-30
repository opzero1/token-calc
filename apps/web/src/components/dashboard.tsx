import type { DashboardSnapshot, Source, TimeRange } from '@token-calc/core'
import {
  Activity,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Database,
  RefreshCw,
} from 'lucide-react'
import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const SOURCE_LABELS: Record<Source, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  amp: 'Amp',
  pi: 'Pi-Agent',
}

const SOURCE_COLORS: Record<Source, string> = {
  'claude-code': '#ff6b35',
  codex: '#00c2ff',
  gemini: '#5ee35b',
  opencode: '#d7d4ff',
  amp: '#ffdc58',
  pi: '#ff8ec3',
}

const RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '7', label: '7D' },
  { value: '30', label: '30D' },
  { value: '90', label: '90D' },
  { value: '180', label: '180D' },
  { value: '365', label: '1Y' },
  { value: 'all', label: 'ALL' },
]

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

function totalTokens(tokens: DashboardSnapshot['totals']['tokens']) {
  return tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead + tokens.reasoning
}

function tokenBreakdown(tokens: DashboardSnapshot['totals']['tokens']) {
  return [
    { key: 'input', label: 'In', value: tokens.input, className: 'bg-accent' },
    { key: 'output', label: 'Out', value: tokens.output, className: 'bg-main' },
    { key: 'cacheCreation', label: 'Cache write', value: tokens.cacheCreation, className: 'bg-[#ffdc58]' },
    { key: 'cacheRead', label: 'Cache read', value: tokens.cacheRead, className: 'bg-muted' },
    { key: 'reasoning', label: 'Reasoning', value: tokens.reasoning, className: 'bg-[#ff8ec3]' },
  ].filter((item) => item.value > 0)
}

function shortModel(model: string) {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/^\[pi\]\s*/, '')
}

function maxOf(values: number[]) {
  return Math.max(1, ...values)
}

const DAY_MS = 24 * 60 * 60 * 1000

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseDateKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`)
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() - next.getUTCDay())
  return next
}

function endOfWeek(date: Date) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + (6 - next.getUTCDay()))
  return next
}

function emptyTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, reasoning: 0 }
}

type TimelineDay = DashboardSnapshot['daily'][number] & {
  isFuture: boolean
}

function buildTimelineDays(snapshot: DashboardSnapshot): TimelineDay[] {
  const generated = new Date(snapshot.generated)
  const todayKey = dateKey(generated)
  const year = generated.getUTCFullYear()
  const dailyByDate = new Map(snapshot.daily.map((day) => [day.date, day]))

  let start: Date
  let end: Date

  if (snapshot.range === '365' || snapshot.range === 'all') {
    start = new Date(Date.UTC(year, 0, 1))
    end = new Date(Date.UTC(year, 11, 31))
  } else {
    const days = Number(snapshot.range)
    const today = parseDateKey(todayKey)
    start = addDays(today, -(days - 1))
    end = today
  }

  const result: TimelineDay[] = []
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const key = dateKey(cursor)
    const existing = dailyByDate.get(key)
    result.push({
      date: key,
      tokens: existing?.tokens ?? emptyTokens(),
      costUSD: existing?.costUSD ?? 0,
      models: existing?.models ?? [],
      sources: existing?.sources ?? [],
      eventCount: existing?.eventCount ?? 0,
      isFuture: key > todayKey,
    })
  }

  return result
}

type HeatmapDay = DashboardSnapshot['heatmap'][number] & {
  inYear: boolean
  isFuture: boolean
}

function buildYearHeatmap(snapshot: DashboardSnapshot): HeatmapDay[] {
  const generated = new Date(snapshot.generated)
  const todayKey = dateKey(generated)
  const year = generated.getUTCFullYear()
  const firstDay = new Date(Date.UTC(year, 0, 1))
  const lastDay = new Date(Date.UTC(year, 11, 31))
  const start = startOfWeek(firstDay)
  const end = endOfWeek(lastDay)
  const heatmapByDate = new Map(snapshot.heatmap.map((cell) => [cell.date, cell]))
  const result: HeatmapDay[] = []

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const key = dateKey(cursor)
    const inYear = cursor.getUTCFullYear() === year
    const isFuture = key > todayKey
    const existing = heatmapByDate.get(key)
    result.push({
      date: key,
      totalTokens: inYear && !isFuture ? (existing?.totalTokens ?? 0) : 0,
      costUSD: inYear && !isFuture ? (existing?.costUSD ?? 0) : 0,
      inYear,
      isFuture,
    })
  }

  return result
}

interface DashboardProps {
  snapshot: DashboardSnapshot
  range: TimeRange
  isRefreshing: boolean
  onRangeChange: (range: TimeRange) => void
  onRefresh: () => void
}

export function Dashboard({ snapshot, range, isRefreshing, onRangeChange, onRefresh }: DashboardProps) {
  const averageCost = snapshot.totals.activeDays > 0 ? snapshot.totals.costUSD / snapshot.totals.activeDays : 0
  const latestGenerated = new Date(snapshot.generated).toLocaleString()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="border-2 border-border bg-main p-4 shadow-shadow sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center border-2 border-border bg-accent shadow-[3px_3px_0_0_var(--border)]">
              <Coins className="size-7" />
            </div>
            <div>
              <h1 className="font-heading text-3xl font-black leading-none sm:text-5xl">token-calc</h1>
              <p className="mt-2 max-w-2xl text-sm font-bold sm:text-base">
                Local AI coding token usage and estimated spend across Claude Code, Codex, Gemini, OpenCode, Amp,
                and Pi-Agent.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TabsList>
              {RANGES.map((item) => (
                <TabsTrigger key={item.value} active={range === item.value} onClick={() => onRangeChange(item.value)}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button className="shrink-0" onClick={onRefresh} variant="neutral">
              <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-2 text-sm font-bold">
        <Badge variant="neutral">
          <Database className="size-3.5" />
          {snapshot.totalEventCount.toLocaleString()} total events
        </Badge>
        <Badge variant="neutral">
          Generated {latestGenerated}
        </Badge>
        {snapshot.detected.length === 0 ? (
          <Badge variant="accent">No local sources detected yet</Badge>
        ) : (
          snapshot.detected.map((source) => (
            <Badge key={source} variant="accent" style={{ backgroundColor: SOURCE_COLORS[source] }}>
              {SOURCE_LABELS[source]}
            </Badge>
          ))
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon={<CircleDollarSign />} label="Total Cost" value={formatUsd(snapshot.totals.costUSD)} />
        <MetricCard icon={<Coins />} label="Total Tokens" value={formatNumber(snapshot.totals.totalTokens)} />
        <MetricCard icon={<CalendarDays />} label="Active Days" value={formatNumber(snapshot.totals.activeDays)} />
        <MetricCard icon={<Activity />} label="Cost / Day" value={formatUsd(averageCost)} />
        <MetricCard icon={<Database />} label="Events" value={formatNumber(snapshot.totals.eventCount)} />
      </section>

      {snapshot.totals.eventCount === 0 ? (
        <EmptyState errors={snapshot.errors} />
      ) : (
        <>
          <DailyStackedBars snapshot={snapshot} />
          <section className="grid gap-5 lg:grid-cols-[0.8fr_1fr]">
            <SourceDonut snapshot={snapshot} />
            <TopModels snapshot={snapshot} />
          </section>
          <section className="grid gap-5 lg:grid-cols-2">
            <MonthlyTrend snapshot={snapshot} />
            <Heatmap snapshot={snapshot} />
          </section>
          <DailyTable snapshot={snapshot} />
        </>
      )}
    </main>
  )
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="metric-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase text-muted-foreground">{label}</div>
          <div className="mt-2 break-words font-heading text-2xl font-black leading-none">{value}</div>
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center border-2 border-border bg-secondary-background shadow-[2px_2px_0_0_var(--border)]">
          {icon}
        </div>
      </div>
    </Card>
  )
}

function EmptyState({ errors }: { errors: DashboardSnapshot['errors'] }) {
  return (
    <Card className="bg-accent p-6">
      <h2 className="font-heading text-2xl font-black">No usage data found</h2>
      <p className="mt-2 max-w-3xl font-bold">
        token-calc scans the same local locations as the reference project. Use at least one supported AI coding tool,
        then refresh this dashboard.
      </p>
      {errors.length > 0 ? (
        <div className="mt-4 border-2 border-border bg-secondary-background p-3 text-sm font-bold">
          {errors.map((error) => (
            <div key={error.source}>
              {SOURCE_LABELS[error.source]}: {error.error}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

function DailyStackedBars({ snapshot }: { snapshot: DashboardSnapshot }) {
  const days = buildTimelineDays(snapshot)
  const sourceByDay = new Map(snapshot.dailyBySource.map((item) => [`${item.date}:${item.source}`, item]))
  const maxCost = maxOf(days.map((day) => day.costUSD))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Cost Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72 overflow-hidden px-6 pb-2">
          <div
            className="grid h-full items-end gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          >
            {days.map((day, index) => {
              const shouldLabel =
                index === 0 ||
                index === days.length - 1 ||
                day.date.endsWith('-01')

              return (
                <div key={day.date} className="flex min-w-0 flex-col items-center gap-2">
                  <div
                    className={cn(
                      'flex h-56 w-full min-w-0 items-end border border-border bg-background',
                      day.isFuture && 'bg-secondary-background opacity-70',
                    )}
                    title={`${day.date}: ${formatNumber(totalTokens(day.tokens))} tokens, ${formatUsd(day.costUSD)}`}
                  >
                    {day.costUSD > 0 ? (
                      <div
                        className="flex w-full flex-col justify-end"
                        style={{ height: `${Math.max(3, (day.costUSD / maxCost) * 100)}%` }}
                      >
                        {day.sources.map((source) => {
                          const item = sourceByDay.get(`${day.date}:${source}`)
                          const height = day.costUSD > 0 && item ? (item.costUSD / day.costUSD) * 100 : 0
                          return (
                            <div
                              key={source}
                              title={`${day.date} ${SOURCE_LABELS[source]} ${formatUsd(item?.costUSD ?? 0)}`}
                              className="border-t border-border first:border-t-0"
                              style={{ height: `${height}%`, backgroundColor: SOURCE_COLORS[source] }}
                            />
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="h-7 w-max whitespace-nowrap text-center text-[10px] font-black leading-none">
                    {shouldLabel ? day.date.slice(5) : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SourceDonut({ snapshot }: { snapshot: DashboardSnapshot }) {
  const rows = snapshot.bySource
  const total = rows.reduce((sum, row) => sum + row.costUSD, 0)
  const radius = 72
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
          <svg className="size-48 shrink-0" viewBox="0 0 190 190" role="img" aria-label="Cost breakdown by source">
            <circle cx="95" cy="95" r={radius} fill="#fffdf4" stroke="#111" strokeWidth="8" />
            {rows.map((row) => {
              const length = total > 0 ? (row.costUSD / total) * circumference : 0
              const dashOffset = offset
              offset -= length
              return (
                <circle
                  key={row.source}
                  cx="95"
                  cy="95"
                  r={radius}
                  fill="transparent"
                  stroke={SOURCE_COLORS[row.source]}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="butt"
                  strokeWidth="28"
                  transform="rotate(-90 95 95)"
                />
              )
            })}
            <text x="95" y="90" textAnchor="middle" className="fill-foreground font-heading text-2xl font-black">
              {formatUsd(total, true)}
            </text>
            <text x="95" y="114" textAnchor="middle" className="fill-muted-foreground text-xs font-black">
              total
            </text>
          </svg>
          <div className="grid w-full gap-2">
            {rows.map((row) => (
              <div key={row.source} className="flex items-center justify-between gap-3 border-2 border-border bg-background px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-4 shrink-0 border-2 border-border" style={{ backgroundColor: SOURCE_COLORS[row.source] }} />
                  <span className="truncate font-black">{SOURCE_LABELS[row.source]}</span>
                </div>
                <span className="font-black">{formatUsd(row.costUSD)}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TopModels({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [activeTab, setActiveTab] = React.useState<'cost' | 'tokens'>('cost')
  const models = snapshot.byModel.slice(0, 8)
  const tokenModels = [...snapshot.byModel].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens)).slice(0, 8)
  const maxCost = maxOf(models.map((model) => model.costUSD))
  const maxTokens = maxOf(tokenModels.map((model) => totalTokens(model.tokens)))

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <CardTitle>Top Models</CardTitle>
        <TabsList className="shadow-[3px_3px_0_0_var(--border)]">
          <TabsTrigger active={activeTab === 'cost'} onClick={() => setActiveTab('cost')}>
            Cost
          </TabsTrigger>
          <TabsTrigger active={activeTab === 'tokens'} onClick={() => setActiveTab('tokens')}>
            Tokens
          </TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent className="grid gap-3">
        {activeTab === 'cost'
          ? models.map((model, index) => (
            <div key={model.model} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-sm font-black">
                <span className="truncate">
                  {index + 1}. {shortModel(model.model)}
                </span>
                <span>{formatUsd(model.costUSD)}</span>
              </div>
              <div className="h-5 border-2 border-border bg-background">
                <div className="h-full border-r-2 border-border bg-accent" style={{ width: `${Math.max(2, (model.costUSD / maxCost) * 100)}%` }} />
              </div>
            </div>
          ))
          : tokenModels.map((model, index) => {
            const total = totalTokens(model.tokens)
            const breakdown = tokenBreakdown(model.tokens)

            return (
              <div key={model.model} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm font-black">
                  <span className="truncate">
                    {index + 1}. {shortModel(model.model)}
                  </span>
                  <span>{formatNumber(total)}</span>
                </div>
                <div className="h-5 border-2 border-border bg-background" title={`${formatNumber(total)} total tokens`}>
                  <div className="h-full border-r-2 border-border bg-accent" style={{ width: `${Math.max(2, (total / maxTokens) * 100)}%` }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-[11px] font-black uppercase">
                  <span>{formatUsd(model.costUSD)}</span>
                  <span>{formatNumber(model.eventCount)} events</span>
                </div>
                <div className="flex h-3 overflow-hidden border-2 border-border bg-background" title={breakdown.map((item) => `${item.label}: ${formatNumber(item.value)}`).join(', ')}>
                  {breakdown.map((item) => (
                    <div
                      key={item.key}
                      className={cn('h-full border-r-2 border-border last:border-r-0', item.className)}
                      style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
                  {breakdown.map((item) => (
                    <span key={item.key} className="whitespace-nowrap">
                      {item.label}: {formatNumber(item.value)}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
      </CardContent>
    </Card>
  )
}

function MonthlyTrend({ snapshot }: { snapshot: DashboardSnapshot }) {
  const months = snapshot.monthly.slice(-12)
  const width = 640
  const height = 240
  const padding = 28
  const maxCost = maxOf(months.map((month) => month.costUSD))
  const points = months.map((month, index) => {
    const x = padding + (index / Math.max(1, months.length - 1)) * (width - padding * 2)
    const y = height - padding - (month.costUSD / maxCost) * (height - padding * 2)
    return { x, y, month }
  })
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full border-2 border-border bg-background">
          <path d={path} fill="none" stroke="#111" strokeWidth="10" strokeLinejoin="round" />
          <path d={path} fill="none" stroke="#ff6b35" strokeWidth="6" strokeLinejoin="round" />
          {points.map((point) => (
            <g key={point.month.month}>
              <circle cx={point.x} cy={point.y} r="7" fill="#00c2ff" stroke="#111" strokeWidth="3" />
              <title>{`${point.month.month}: ${formatUsd(point.month.costUSD)}`}</title>
            </g>
          ))}
        </svg>
      </CardContent>
    </Card>
  )
}

function Heatmap({ snapshot }: { snapshot: DashboardSnapshot }) {
  const cells = buildYearHeatmap(snapshot)
  const maxCost = maxOf(cells.map((cell) => cell.costUSD))
  const year = new Date(snapshot.generated).getUTCFullYear()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{year} Activity Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-flow-col grid-rows-7 justify-start gap-1 overflow-x-auto pb-2">
          {cells.map((cell) => {
            const level = Math.ceil((cell.costUSD / maxCost) * 4)
            const colors = ['#fffdf4', '#c8facc', '#ffdc58', '#ff8ec3', '#ff6b35']
            return (
              <div
                key={cell.date}
                className={cn(
                  'size-5 border-2 border-border',
                  !cell.inYear && 'invisible',
                  cell.isFuture && 'bg-secondary-background opacity-70',
                )}
                style={{ backgroundColor: colors[level] }}
                title={`${cell.date}: ${formatNumber(cell.totalTokens)} tokens, ${formatUsd(cell.costUSD)}`}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

type SortKey = 'date' | 'cost' | 'tokens' | 'events'

function DailyTable({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [sortKey, setSortKey] = React.useState<SortKey>('date')
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const detailByDate = React.useMemo(() => {
    const map = new Map<string, typeof snapshot.dailyBySourceModel>()
    for (const row of snapshot.dailyBySourceModel) {
      const rows = map.get(row.date) ?? []
      rows.push(row)
      map.set(row.date, rows)
    }
    return map
  }, [snapshot.dailyBySourceModel])

  const rows = React.useMemo(() => {
    return [...snapshot.daily].sort((a, b) => {
      if (sortKey === 'date') return b.date.localeCompare(a.date)
      if (sortKey === 'cost') return b.costUSD - a.costUSD
      if (sortKey === 'tokens') return totalTokens(b.tokens) - totalTokens(a.tokens)
      return b.eventCount - a.eventCount
    })
  }, [snapshot.daily, sortKey])

  function toggle(date: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Details</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" sortKey="date" active={sortKey === 'date'} onSort={setSortKey} />
              <TableHead>Sources</TableHead>
              <TableHead>Models</TableHead>
              <SortableHead label="Tokens" sortKey="tokens" active={sortKey === 'tokens'} onSort={setSortKey} className="text-right" />
              <SortableHead label="Cost" sortKey="cost" active={sortKey === 'cost'} onSort={setSortKey} className="text-right" />
              <SortableHead label="Events" sortKey="events" active={sortKey === 'events'} onSort={setSortKey} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((day) => (
              <React.Fragment key={day.date}>
                <TableRow className="cursor-pointer hover:bg-muted" onClick={() => toggle(day.date)}>
                  <TableCell className="font-black">
                    <ChevronDown className={cn('mr-2 inline size-4 transition-transform', expanded.has(day.date) && 'rotate-180')} />
                    {day.date}
                  </TableCell>
                  <TableCell>{day.sources.map((source) => SOURCE_LABELS[source]).join(', ')}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{day.models.map(shortModel).join(', ')}</TableCell>
                  <TableCell className="text-right font-black">{formatNumber(totalTokens(day.tokens))}</TableCell>
                  <TableCell className="text-right font-black">{formatUsd(day.costUSD)}</TableCell>
                  <TableCell className="text-right font-black">{day.eventCount.toLocaleString()}</TableCell>
                </TableRow>
                {expanded.has(day.date)
                  ? (detailByDate.get(day.date) ?? []).map((detail) => (
                      <TableRow key={`${detail.date}:${detail.source}:${detail.model}`} className="bg-secondary-background">
                        <TableCell />
                        <TableCell className="font-black">{SOURCE_LABELS[detail.source]}</TableCell>
                        <TableCell>{shortModel(detail.model)}</TableCell>
                        <TableCell className="text-right">{formatNumber(totalTokens(detail.tokens))}</TableCell>
                        <TableCell className="text-right">{formatUsd(detail.costUSD)}</TableCell>
                        <TableCell className="text-right">{detail.eventCount.toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  : null}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function SortableHead({
  label,
  sortKey,
  active,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  active: boolean
  onSort: (key: SortKey) => void
  className?: string
}) {
  return (
    <TableHead className={className}>
      <button
        className={cn('inline-flex items-center gap-1 font-heading font-black', active && 'underline decoration-2 underline-offset-4')}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowUpDown className="size-3.5" />
      </button>
    </TableHead>
  )
}
