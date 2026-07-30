import type { DashboardSnapshot, Source, TimeRange } from '@token-calc/core'
import {
  Activity,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Coins,
  Gauge,
  Layers3,
  RefreshCw,
  ScanLine,
} from 'lucide-react'
import * as React from 'react'

import { Glass } from '@/components/canvasui/Glass'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  'claude-code': '#f97360',
  codex: '#d9ff63',
  gemini: '#60a5fa',
  opencode: '#a78bfa',
  amp: '#fbbf24',
  pi: '#f472b6',
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
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1_000_000 ? 'compact' : 'standard',
  }).format(value)
}

function formatCompactTokens(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value)
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

function AnimatedTokenCount({ value }: { value: number }) {
  const initialValue = Math.max(0, value - Math.min(Math.max(value * 0.004, 1_000_000), 100_000_000))
  const [displayValue, setDisplayValue] = React.useState(initialValue)
  const displayValueRef = React.useRef(initialValue)

  React.useEffect(() => {
    const from = displayValueRef.current
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || from === value) {
      displayValueRef.current = value
      setDisplayValue(value)
      return
    }

    const startedAt = performance.now()
    const duration = 1_200
    let frameId = 0

    function animate(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextValue = Math.round(from + (value - from) * eased)
      displayValueRef.current = nextValue
      setDisplayValue(nextValue)
      if (progress < 1) frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frameId)
  }, [value])

  return (
    <div aria-live="polite">
      <div className="font-heading text-3xl font-medium leading-none tracking-[-0.05em] sm:text-4xl">
        {formatCompactTokens(displayValue)}
      </div>
      <div className="mt-2 font-heading text-[11px] tabular-nums text-muted-foreground">
        {displayValue.toLocaleString()} tokens indexed
      </div>
    </div>
  )
}

function tokenBreakdown(tokens: DashboardSnapshot['totals']['tokens']) {
  return [
    { key: 'input', label: 'In', value: tokens.input, className: 'bg-[#7cf3b5]' },
    { key: 'output', label: 'Out', value: tokens.output, className: 'bg-[#60a5fa]' },
    {
      key: 'cacheCreation',
      label: 'Cache write',
      value: tokens.cacheCreation,
      className: 'bg-[#a78bfa]',
    },
    { key: 'cacheRead', label: 'Cache read', value: tokens.cacheRead, className: 'bg-[#fbbf24]' },
    { key: 'reasoning', label: 'Reasoning', value: tokens.reasoning, className: 'bg-[#f472b6]' },
  ].filter((item) => item.value > 0)
}

function shortModel(model: string) {
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/^\[pi\]\s*/, '')
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

export function DashboardLoading() {
  return (
    <main className="app-shell min-h-screen">
      <header className="topbar">
        <div className="flex items-center gap-3">
          <div className="skeleton size-9 shrink-0 rounded-full" />
          <div className="grid gap-1.5">
            <div className="skeleton h-3 w-24 rounded" />
            <div className="skeleton h-2 w-16 rounded" />
          </div>
        </div>
      </header>
      <div className="dashboard-content dashboard-stack mx-auto flex w-full max-w-[1500px] flex-col">
        <section className="hero-panel min-h-[330px]">
          <div className="hero-content grid h-full lg:grid-cols-[1.15fr_0.85fr]">
            <div className="grid content-center gap-5">
              <div className="skeleton h-3 w-40 rounded" />
              <div className="skeleton h-20 max-w-2xl rounded-2xl" />
              <div className="skeleton h-4 max-w-lg rounded" />
            </div>
            <div className="skeleton min-h-52 rounded-[2rem]" />
          </div>
        </section>
        <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <RefreshCw className="size-3.5 animate-spin text-main" />
          Reading local model activity
        </div>
        <section className="content-grid grid sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="h-32 p-[var(--card-padding)]">
              <div className="skeleton h-3 w-20 rounded" />
              <div className="skeleton mt-5 h-8 w-28 rounded-lg" />
            </Card>
          ))}
        </section>
      </div>
    </main>
  )
}

export function Dashboard({ snapshot, range, isRefreshing, onRangeChange, onRefresh }: DashboardProps) {
  const averageCost = snapshot.totals.activeDays > 0 ? snapshot.totals.costUSD / snapshot.totals.activeDays : 0
  const latestGenerated = new Date(snapshot.generated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const rangeLabel = RANGES.find((item) => item.value === range)?.label ?? range
  const tokenGoal = (Math.floor(snapshot.totals.totalTokens / 1_000_000_000) + 1) * 1_000_000_000
  const tokensToGoal = tokenGoal - snapshot.totals.totalTokens
  const tokenGoalProgress = Math.min(100, (snapshot.totals.totalTokens / tokenGoal) * 100)

  return (
    <Glass
      shape="circle"
      size={112}
      ior={1.32}
      edge={0.72}
      bevel={4}
      depth={180}
      aberration={0.55}
      reflection={0.7}
      shine={0.35}
      zoom={1.16}
      follow={0.16}
      targets="[data-glass-target]"
      className="min-h-screen"
    >
      <div className="app-shell min-h-screen">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <div className="brand-mark">
              <ScanLine className="size-[18px]" />
            </div>
            <div>
              <div className="font-heading text-sm font-semibold tracking-[-0.02em]">token / lens</div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Local intelligence
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className={cn('status-dot', isRefreshing && 'is-active')} />
              {isRefreshing ? 'Scanning' : `Synced ${latestGenerated}`}
            </div>
            <Button aria-label="Refresh usage data" onClick={onRefresh} variant="neutral" size="icon" disabled={isRefreshing}>
              <RefreshCw className={cn(isRefreshing && 'animate-spin')} />
            </Button>
          </div>
        </header>

        <main className="dashboard-content dashboard-stack mx-auto flex w-full max-w-[1500px] flex-col">
          <section className="hero-panel">
            <div className="hero-grid" aria-hidden />
            <div className="hero-glow" aria-hidden />
            <div className="hero-content relative grid lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
              <div className="flex flex-col items-start">
                <div className="eyebrow">
                  <span className="status-dot is-active" />
                  Usage observatory / {rangeLabel}
                </div>
                <h1 className="mt-7 max-w-3xl font-heading text-[clamp(2.75rem,7vw,6.75rem)] font-medium leading-[0.86] tracking-[-0.08em]">
                  See what your <span className="text-main">agents</span> consume.
                </h1>
                <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                  A private, local readout of token volume and estimated model spend across every coding agent on this
                  machine.
                </p>
                <TabsList className="mt-7 w-full sm:w-auto" aria-label="Usage window">
                  {RANGES.map((item) => (
                    <TabsTrigger key={item.value} active={range === item.value} onClick={() => onRangeChange(item.value)}>
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              <div className="spend-readout" data-glass-target>
                <div className="flex items-center justify-between gap-4">
                  <span className="eyebrow">Estimated spend</span>
                  <CircleDollarSign className="size-5 text-main" />
                </div>
                <div className="mt-12 font-heading text-[clamp(3.25rem,7vw,6rem)] font-medium leading-none tracking-[-0.08em]">
                  {formatUsd(snapshot.totals.costUSD)}
                </div>
                <div className="mt-5 border-t border-border pt-5">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Live token volume
                      </div>
                      <AnimatedTokenCount value={snapshot.totals.totalTokens} />
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        Next goal
                      </div>
                      <div className="mt-2 font-heading text-xl font-medium text-main">{formatCompactTokens(tokenGoal)}</div>
                    </div>
                  </div>
                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className="h-full rounded-full bg-main transition-[width] duration-1000 ease-out"
                      style={{ width: `${tokenGoalProgress}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <span>{tokenGoalProgress.toFixed(1)}% complete</span>
                    <span>{formatCompactTokens(tokensToGoal)} remaining</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="source-strip" aria-label="Detected local sources">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <Layers3 className="size-3.5" />
              Live inputs
            </div>
            <div className="flex flex-wrap gap-2">
              {snapshot.detected.length === 0 ? (
                <Badge variant="neutral">No sources found</Badge>
              ) : (
                snapshot.detected.map((source) => (
                  <Badge key={source} variant="neutral" className="source-badge">
                    <span className="size-2 rounded-full" style={{ backgroundColor: SOURCE_COLORS[source] }} />
                    {SOURCE_LABELS[source]}
                  </Badge>
                ))
              )}
            </div>
            <div className="ml-auto hidden text-xs text-muted-foreground md:block">
              {snapshot.totalEventCount.toLocaleString()} events indexed
            </div>
          </section>

          <section className="content-grid grid sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={<CalendarDays />} label="Active days" value={formatNumber(snapshot.totals.activeDays)} detail="Days with recorded usage" />
            <MetricCard icon={<Gauge />} label="Daily burn" value={formatUsd(averageCost)} detail="Average per active day" />
            <MetricCard icon={<Activity />} label="Requests" value={formatNumber(snapshot.totals.eventCount)} detail="Model events in this window" />
            <MetricCard icon={<Coins />} label="Tracked tools" value={formatNumber(snapshot.detected.length)} detail="Local sources reporting" />
          </section>

          {snapshot.totals.eventCount === 0 ? (
            <EmptyState errors={snapshot.errors} />
          ) : (
            <>
              <DailyStackedBars snapshot={snapshot} />
              <section className="content-grid grid lg:grid-cols-[0.82fr_1.18fr]">
                <SourceDonut snapshot={snapshot} />
                <TopModels snapshot={snapshot} />
              </section>
              <Heatmap snapshot={snapshot} />
              <DailyTable snapshot={snapshot} />
            </>
          )}

          <footer className="flex flex-col gap-2 border-t border-border px-1 pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>All analysis stays on this machine.</span>
            <span>Last indexed at {latestGenerated}</span>
          </footer>
        </main>
      </div>
    </Glass>
  )
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
}) {
  return (
    <Card className="metric-card group overflow-hidden p-[var(--card-padding)]" data-glass-target>
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-white/[0.025] text-muted-foreground transition-colors group-hover:border-main/30 group-hover:text-main">
          {icon}
        </div>
        <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      </div>
      <div className="mt-8 break-words font-heading text-3xl font-medium leading-none tracking-[-0.05em]">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </Card>
  )
}

function EmptyState({ errors }: { errors: DashboardSnapshot['errors'] }) {
  return (
    <Card className="overflow-hidden p-6 sm:p-10">
      <div className="mb-8 flex size-14 items-center justify-center rounded-full border border-main/25 bg-main/10 text-main">
        <ScanLine className="size-6" />
      </div>
      <div className="eyebrow">Awaiting signal</div>
      <h2 className="mt-4 font-heading text-3xl font-medium tracking-[-0.05em]">No usage data found</h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
        token-calc scans the same local locations as the reference project. Use at least one supported AI coding tool,
        then refresh this dashboard.
      </p>
      {errors.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
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
        <div className="eyebrow">01 / Velocity</div>
        <CardTitle className="mt-2 text-2xl sm:text-3xl">Daily spend</CardTitle>
        <CardDescription>Estimated cost per day, segmented by local coding tool.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-72 overflow-x-auto px-1 pb-2 sm:px-2">
          <div
            className="grid h-full items-end gap-1"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(4px, 1fr))`,
              minWidth: `${Math.max(560, days.length * 8)}px`,
            }}
          >
            {days.map((day, index) => {
              const shouldLabel = index === 0 || index === days.length - 1 || day.date.endsWith('-01')

              return (
                <div key={day.date} className="flex min-w-0 flex-col items-center gap-2">
                  <div
                    className={cn(
                      'flex h-56 w-full min-w-0 items-end overflow-hidden rounded-t-md bg-background',
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
                              className="border-t border-black/20 first:border-t-0"
                              style={{
                                height: `${height}%`,
                                backgroundColor: SOURCE_COLORS[source],
                              }}
                            />
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="h-7 w-max whitespace-nowrap text-center text-[9px] font-semibold leading-none text-muted-foreground">
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
        <div className="eyebrow">02 / Distribution</div>
        <CardTitle className="mt-2 text-2xl">Tool mix</CardTitle>
        <CardDescription>Where estimated spend is originating.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
          <svg className="size-48 shrink-0" viewBox="0 0 190 190" role="img" aria-label="Cost breakdown by source">
            <circle
              cx="95"
              cy="95"
              r={radius}
              fill="var(--secondary-background)"
              stroke="var(--border)"
              strokeWidth="8"
            />
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
              <div
                key={row.source}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white/[0.03] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: SOURCE_COLORS[row.source] }}
                  />
                  <span className="truncate font-semibold">{SOURCE_LABELS[row.source]}</span>
                </div>
                <span className="font-heading text-sm font-bold">{formatUsd(row.costUSD)}</span>
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
        <div>
          <div className="eyebrow">03 / Models</div>
          <CardTitle className="mt-2 text-2xl">Model leaderboard</CardTitle>
          <CardDescription className="mt-1">Ranked by cost or total token volume.</CardDescription>
        </div>
        <TabsList>
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
                <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                  <span className="truncate">
                    {index + 1}. {shortModel(model.model)}
                  </span>
                  <span>{formatUsd(model.costUSD)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#8b5cf6] to-main"
                    style={{ width: `${Math.max(2, (model.costUSD / maxCost) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          : tokenModels.map((model, index) => {
              const total = totalTokens(model.tokens)
              const breakdown = tokenBreakdown(model.tokens)

              return (
                <div key={model.model} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                    <span className="truncate">
                      {index + 1}. {shortModel(model.model)}
                    </span>
                    <span>{formatNumber(total)}</span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-background"
                    title={`${formatNumber(total)} total tokens`}
                  >
                    <div
                      className="h-full rounded-full bg-main"
                      style={{ width: `${Math.max(2, (total / maxTokens) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[11px] font-black uppercase">
                    <span>{formatUsd(model.costUSD)}</span>
                    <span>{formatNumber(model.eventCount)} events</span>
                  </div>
                  <div
                    className="flex h-2 overflow-hidden rounded-full bg-background"
                    title={breakdown.map((item) => `${item.label}: ${formatNumber(item.value)}`).join(', ')}
                  >
                    {breakdown.map((item) => (
                      <div
                        key={item.key}
                        className={cn('h-full border-r border-background last:border-r-0', item.className)}
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

function Heatmap({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [hovered, setHovered] = React.useState<HeatmapDay | null>(null)
  const cells = buildYearHeatmap(snapshot)
  const maxCost = maxOf(cells.map((cell) => cell.costUSD))
  const year = new Date(snapshot.generated).getUTCFullYear()
  const weeks = Math.ceil(cells.length / 7)
  const monthLabels = cells.flatMap((cell, index) => {
    const date = parseDateKey(cell.date)
    if (!cell.inYear || date.getUTCDate() !== 1) return []
    return [{ label: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), week: Math.floor(index / 7) }]
  })

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow">04 / Year in focus</div>
          <CardTitle className="mt-2 text-2xl">{year} activity</CardTitle>
          <CardDescription className="mt-1">A day-by-day view of token activity and estimated spend.</CardDescription>
        </div>
        <div className="min-h-[68px] min-w-60 rounded-xl border border-border bg-black/15 px-4 py-3 md:text-right">
          {hovered ? (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {parseDateKey(hovered.date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </div>
              <div className="mt-2 font-heading text-sm font-medium">
                {formatCompactTokens(hovered.totalTokens)} tokens <span className="text-muted-foreground">/</span>{' '}
                {formatUsd(hovered.costUSD)}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center text-xs leading-5 text-muted-foreground md:justify-end">
              Hover a date to inspect its usage.
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[64rem]">
            <div
              className="mb-2 ml-9 grid gap-[3px] text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${weeks}, 1rem)` }}
            >
              {monthLabels.map((month) => (
                <span key={`${month.label}:${month.week}`} style={{ gridColumn: month.week + 1 }}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="grid w-7 shrink-0 grid-rows-7 gap-[3px] text-[9px] font-medium text-muted-foreground">
                {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((label, index) => (
                  <span key={index} className="flex h-4 items-center">
                    {label}
                  </span>
                ))}
              </div>
              <div
                className="grid grid-flow-col grid-rows-7 justify-start gap-[3px]"
                onMouseLeave={() => setHovered(null)}
              >
                {cells.map((cell) => {
                  const level = Math.ceil((cell.costUSD / maxCost) * 4)
                  const colors = ['#17181d', '#303720', '#596b25', '#91b83d', '#d9ff63']
                  return (
                    <div
                      key={cell.date}
                      className={cn(
                        'size-4 rounded-[4px] border border-border transition-transform duration-150 hover:scale-125 hover:border-white/40',
                        !cell.inYear && 'invisible',
                        cell.isFuture && 'bg-secondary-background opacity-70',
                      )}
                      style={{ backgroundColor: colors[level] }}
                      title={`${cell.date}: ${formatNumber(cell.totalTokens)} tokens, ${formatUsd(cell.costUSD)}`}
                      onMouseEnter={() => setHovered(cell)}
                    />
                  )
                })}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span>Less</span>
              {['#17181d', '#303720', '#596b25', '#91b83d', '#d9ff63'].map((color) => (
                <span key={color} className="size-3 rounded-[3px] border border-border" style={{ backgroundColor: color }} />
              ))}
              <span>More</span>
            </div>
          </div>
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
        <div className="eyebrow">05 / Ledger</div>
        <CardTitle className="mt-2 text-2xl">Daily details</CardTitle>
        <CardDescription>Select a row to inspect tool and model usage.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Date" sortKey="date" active={sortKey === 'date'} onSort={setSortKey} />
              <TableHead>Sources</TableHead>
              <TableHead>Models</TableHead>
              <SortableHead
                label="Tokens"
                sortKey="tokens"
                active={sortKey === 'tokens'}
                onSort={setSortKey}
                className="text-right"
              />
              <SortableHead
                label="Cost"
                sortKey="cost"
                active={sortKey === 'cost'}
                onSort={setSortKey}
                className="text-right"
              />
              <SortableHead
                label="Events"
                sortKey="events"
                active={sortKey === 'events'}
                onSort={setSortKey}
                className="text-right"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((day) => (
              <React.Fragment key={day.date}>
                <TableRow className="cursor-pointer hover:bg-white/[0.04]" onClick={() => toggle(day.date)}>
                  <TableCell className="font-black">
                    <ChevronDown
                      className={cn('mr-2 inline size-4 transition-transform', expanded.has(day.date) && 'rotate-180')}
                    />
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
                      <TableRow key={`${detail.date}:${detail.source}:${detail.model}`} className="bg-white/[0.025]">
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
        className={cn('inline-flex items-center gap-1 font-heading font-bold', active && 'text-main')}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowUpDown className="size-3.5" />
      </button>
    </TableHead>
  )
}
