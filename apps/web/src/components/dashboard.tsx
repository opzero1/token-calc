import type { TimeRange } from '@token-calc/core'
import {
  Activity,
  CalendarDays,
  ChevronDown,
  Coins,
  Gauge,
  RefreshCw,
  ScanLine,
} from 'lucide-react'
import * as React from 'react'

import { ActivityRhythm } from '@/components/activity-rhythm'
import { Glass } from '@/components/canvasui/Glass'
import { SpendChart } from '@/components/spend-chart'
import { TokenSkyline } from '@/components/token-skyline'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  formatCompactTokens,
  formatNumber,
  formatUsd,
  RANGES,
  SOURCE_COLORS,
  SOURCE_LABELS,
  totalTokens,
} from '@/lib/format'
import type { WebSnapshot } from '@/lib/snapshot'
import { cn } from '@/lib/utils'

export type RangeState = { loading: boolean; live: boolean }

function useTweenedNumber(value: number, duration: number, initialValue = value) {
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
    let frameId = 0

    function animate(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextValue = from + (value - from) * eased
      displayValueRef.current = nextValue
      setDisplayValue(nextValue)
      if (progress < 1) frameId = window.requestAnimationFrame(animate)
    }

    frameId = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frameId)
  }, [duration, value])

  return displayValue
}

function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  return <>{format(useTweenedNumber(value, 700))}</>
}

function AnimatedTokenCount({ value }: { value: number }) {
  const displayValue = Math.round(
    useTweenedNumber(value, 1_200, Math.max(0, value - Math.min(Math.max(value * 0.004, 1_000_000), 100_000_000))),
  )

  return (
    <div aria-live="polite">
      <div className="mt-3 font-heading text-[clamp(2rem,3.4vw,3.25rem)] font-medium leading-none tracking-[-0.06em]">
        {formatCompactTokens(displayValue)}
      </div>
      <div className="mt-2 font-heading text-[11px] tabular-nums text-muted-foreground">
        {displayValue.toLocaleString()} tokens indexed
      </div>
    </div>
  )
}

function formatCount(value: number) {
  return formatNumber(Math.round(value))
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

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface DashboardProps {
  snapshot: WebSnapshot | null
  range: TimeRange
  rangeState: (range: TimeRange) => RangeState
  error: string | null
  eventCount: number | null
  onRangeChange: (range: TimeRange) => void
  onRefresh: () => void
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

function EventTicker({ value }: { value: number }) {
  const [rolled, setRolled] = React.useState(false)
  const [delta, setDelta] = React.useState<{ id: number; amount: number } | null>(null)
  const previous = React.useRef<number | null>(null)

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => setRolled(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  React.useEffect(() => {
    const before = previous.current
    previous.current = value
    if (before !== null && value > before) {
      setDelta((current) => ({ id: (current?.id ?? 0) + 1, amount: value - before }))
    }
  }, [value])

  const text = value.toLocaleString('en-US')
  const characters = [...text]
  return (
    <span className="relative inline-flex items-center gap-1.5">
      <span className="sr-only">{text} events indexed</span>
      <span aria-hidden className="odometer text-foreground">
        {characters.map((character, index) => {
          const place = characters.length - index
          if (!/\d/.test(character)) return <span key={`separator-${place}`}>{character}</span>
          return (
            <span key={place} className="odometer-digit">
              <span
                className="odometer-strip"
                style={{
                  transform: `translateY(-${(rolled ? Number(character) : 0) * 10}%)`,
                  transitionDelay: `${place * 40}ms`,
                }}
              >
                {DIGITS.map((digit) => (
                  <span key={digit}>{digit}</span>
                ))}
              </span>
            </span>
          )
        })}
      </span>
      <span aria-hidden>events</span>
      {delta ? (
        <span key={delta.id} className="event-delta" role="status">
          +{formatNumber(delta.amount)}
        </span>
      ) : null}
    </span>
  )
}

function SyncStatus({
  snapshot,
  state,
  error,
  eventCount,
}: {
  snapshot: WebSnapshot | null
  state: RangeState
  error: string | null
  eventCount: number | null
}) {
  const generated = snapshot ? formatClock(snapshot.generated) : null
  let label: string
  if (state.loading) label = snapshot && !state.live ? `Saved ${generated} · scanning` : 'Scanning'
  else if (error && !state.live) label = 'Scan failed'
  else if (snapshot) label = state.live ? `Synced ${generated}` : `Saved ${generated}`
  else label = 'Waiting for data'

  return (
    <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex" title={error ?? undefined}>
      <span className={cn('status-dot', state.loading && 'is-active', error && !state.loading && 'is-error')} />
      {label}
      {eventCount !== null ? (
        <>
          <span aria-hidden className="text-border">
            /
          </span>
          <EventTicker value={eventCount} />
        </>
      ) : null}
    </div>
  )
}


function Placeholder({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} />
}

export function Dashboard({ snapshot, range, rangeState, error, eventCount, onRangeChange, onRefresh }: DashboardProps) {
  const state = rangeState(range)
  const rangeLabel = RANGES.find((item) => item.value === range)?.label ?? range
  const averageCost = snapshot && snapshot.totals.activeDays > 0 ? snapshot.totals.costUSD / snapshot.totals.activeDays : 0

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
            <SyncStatus snapshot={snapshot} state={state} error={error} eventCount={eventCount} />
            <Button aria-label="Refresh usage data" onClick={onRefresh} variant="neutral" size="icon" disabled={state.loading}>
              <RefreshCw className={cn(state.loading && 'animate-spin')} />
            </Button>
          </div>
        </header>

        <main className="dashboard-content dashboard-stack mx-auto flex w-full max-w-[1500px] flex-col">
          <section className="hero-panel rise-in">
            <div className="hero-grid" aria-hidden />
            <div className="hero-glow" aria-hidden />
            <div className="hero-content relative grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="flex min-w-0 flex-col items-start">
                <div className="eyebrow">
                  <span className="status-dot is-active" />
                  Usage observatory / {rangeLabel}
                </div>
                <h1 className="mt-7 max-w-3xl font-heading text-[clamp(2.75rem,6vw,5.75rem)] font-medium leading-[0.86] tracking-[-0.08em]">
                  See what your <span className="text-main">agents</span> consume.
                </h1>
                <p className="mt-6 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                  A private, local readout of token volume and estimated model spend across every coding agent on this
                  machine.
                </p>
                <TabsList className="mt-7 w-full sm:w-auto" aria-label="Usage window">
                  {RANGES.map((item) => (
                    <TabsTrigger
                      key={item.value}
                      active={range === item.value}
                      onClick={() => onRangeChange(item.value)}
                    >
                      {item.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="mt-9 grid w-full gap-6 border-t border-border pt-6 sm:max-w-xl sm:grid-cols-2">
                  <div data-glass-target>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Estimated spend
                    </div>
                    {snapshot ? (
                      <div className="mt-3 font-heading text-[clamp(2rem,3.4vw,3.25rem)] font-medium leading-none tracking-[-0.06em]">
                        <AnimatedNumber value={snapshot.totals.costUSD} format={formatUsd} />
                      </div>
                    ) : (
                      <Placeholder className="mt-3 h-[clamp(2rem,3.4vw,3.25rem)] w-44" />
                    )}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {snapshot ? (
                        <>
                          <AnimatedNumber value={averageCost} format={formatUsd} /> per active day
                        </>
                      ) : (
                        'Calculating'
                      )}
                    </div>
                  </div>
                  <div data-glass-target>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Token volume
                    </div>
                    {snapshot ? (
                      <AnimatedTokenCount value={snapshot.totals.totalTokens} />
                    ) : (
                      <div className="mt-3 grid gap-2">
                        <Placeholder className="h-[clamp(2rem,3.4vw,3.25rem)] w-32" />
                        <Placeholder className="h-3 w-40 rounded" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <TokenSkyline snapshot={snapshot} syncing={state.loading} className="min-h-[24rem] sm:min-h-[28rem]" />
            </div>
          </section>

          <section className="content-grid grid sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<CalendarDays />}
              label="Active days"
              value={snapshot?.totals.activeDays ?? null}
              format={formatCount}
              detail="Days with recorded usage"
              order={1}
            />
            <MetricCard
              icon={<Gauge />}
              label="Daily burn"
              value={snapshot ? averageCost : null}
              format={formatUsd}
              detail="Average per active day"
              order={2}
            />
            <MetricCard
              icon={<Activity />}
              label="Requests"
              value={snapshot?.totals.eventCount ?? null}
              format={formatCount}
              detail="Model events in this window"
              order={3}
            />
            <MetricCard
              icon={<Coins />}
              label="Tracked tools"
              value={snapshot?.detected.length ?? null}
              format={formatCount}
              detail="Local sources reporting"
              order={4}
            />
          </section>

          {!snapshot ? (
            <>
              <ChartPlaceholder className="h-[440px]" />
              <section className="content-grid grid lg:grid-cols-[1.3fr_0.7fr]">
                <ChartPlaceholder className="h-[480px]" />
                <ChartPlaceholder className="h-[480px]" />
              </section>
            </>
          ) : snapshot.totals.eventCount === 0 ? (
            <EmptyState errors={snapshot.errors} />
          ) : (
            <>
              <div className="rise-in min-w-0">
                <SpendChart snapshot={snapshot} />
              </div>
              <section className="content-grid rise-in grid lg:grid-cols-[1.3fr_0.7fr]" style={{ animationDelay: '90ms' }}>
                <ActivityRhythm snapshot={snapshot} />
                <TopModels snapshot={snapshot} />
              </section>
              <div className="rise-in min-w-0" style={{ animationDelay: '180ms' }}>
                <DailyTable snapshot={snapshot} />
              </div>
            </>
          )}
        </main>
      </div>
    </Glass>
  )
}

function ChartPlaceholder({ className }: { className?: string }) {
  return (
    <Card className={cn('overflow-hidden p-[var(--card-padding)]', className)}>
      <Placeholder className="h-3 w-24 rounded" />
      <Placeholder className="mt-4 h-7 w-48" />
      <Placeholder className="mt-8 h-[calc(100%-6rem)] w-full rounded-2xl opacity-60" />
    </Card>
  )
}

function MetricCard({
  icon,
  label,
  value,
  format,
  detail,
  order,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
  format: (value: number) => string
  detail: string
  order: number
}) {
  return (
    <Card
      className="metric-card rise-in group overflow-hidden p-[var(--card-padding)]"
      style={{ animationDelay: `${order * 70}ms` }}
      data-glass-target
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-white/[0.025] text-muted-foreground transition-colors group-hover:border-main/30 group-hover:text-main">
          {icon}
        </div>
        <span className="font-heading text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      </div>
      {value === null ? (
        <Placeholder className="mt-8 h-[1.875rem] w-28" />
      ) : (
        <div className="mt-8 break-words font-heading text-3xl font-medium leading-none tracking-[-0.05em]">
          <AnimatedNumber value={value} format={format} />
        </div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </Card>
  )
}

function EmptyState({ errors }: { errors: WebSnapshot['errors'] }) {
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

const TOKEN_PARTS = [
  { key: 'input', label: 'Input', color: '#7cf3b5' },
  { key: 'output', label: 'Output', color: '#60a5fa' },
  { key: 'cacheCreation', label: 'Cache write', color: '#a78bfa' },
  { key: 'cacheRead', label: 'Cache read', color: '#fbbf24' },
  { key: 'reasoning', label: 'Reasoning', color: '#f472b6' },
] as const

function TokenMixBar({ tokens, width, delay }: { tokens: WebSnapshot['totals']['tokens']; width: number; delay: number }) {
  const total = totalTokens(tokens)
  return (
    <div
      className="bar-grow flex h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out"
      style={{ width: `${width}%`, animationDelay: `${delay}ms` }}
    >
      {TOKEN_PARTS.map((part) =>
        tokens[part.key] > 0 ? (
          <span
            key={part.key}
            className="h-full border-r border-black/40 last:border-r-0"
            style={{ width: `${(tokens[part.key] / Math.max(1, total)) * 100}%`, backgroundColor: part.color }}
          />
        ) : null,
      )}
    </div>
  )
}

function TopModels({ snapshot }: { snapshot: WebSnapshot }) {
  const [metric, setMetric] = React.useState<'cost' | 'tokens'>('cost')
  const valueOf = (model: WebSnapshot['byModel'][number]) => (metric === 'cost' ? model.costUSD : totalTokens(model.tokens))
  const models = [...snapshot.byModel].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 8)
  const maxValue = maxOf(models.map(valueOf))

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">03 / Models</div>
          <CardTitle className="mt-2 text-2xl">Model leaderboard</CardTitle>
          <CardDescription className="mt-1">Top models by {metric === 'cost' ? 'spend' : 'tokens'}, colored by token mix.</CardDescription>
        </div>
        <TabsList aria-label="Rank models by">
          <TabsTrigger active={metric === 'cost'} onClick={() => setMetric('cost')}>
            Spend
          </TabsTrigger>
          <TabsTrigger active={metric === 'tokens'} onClick={() => setMetric('tokens')}>
            Tokens
          </TabsTrigger>
        </TabsList>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <ol className="grid gap-0.5">
          {models.map((model, index) => {
            const tokenTotal = totalTokens(model.tokens)
            const detail = TOKEN_PARTS.filter((part) => model.tokens[part.key] > 0)
              .map((part) => `${part.label}: ${formatCompactTokens(model.tokens[part.key])}`)
              .join(' · ')
            return (
              <li
                key={model.model}
                className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.035]"
                title={detail}
              >
                <span className="row-span-2 self-start pt-px font-heading text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="truncate text-sm font-semibold">{shortModel(model.model)}</span>
                <span className="text-right font-heading text-sm font-medium tabular-nums">
                  {metric === 'cost' ? formatUsd(model.costUSD) : formatCompactTokens(tokenTotal)}
                </span>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <TokenMixBar tokens={model.tokens} width={Math.max(2, (valueOf(model) / maxValue) * 100)} delay={200 + index * 60} />
                </div>
                <span className="text-right text-[11px] tabular-nums text-muted-foreground">
                  {metric === 'cost' ? `${formatCompactTokens(tokenTotal)} tok` : formatUsd(model.costUSD, true)} ·{' '}
                  {formatNumber(model.eventCount)} req
                </span>
              </li>
            )
          })}
        </ol>
        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border pt-4 text-[10px] font-semibold text-muted-foreground">
          {TOKEN_PARTS.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: part.color }} />
              {part.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

type SortKey = 'date' | 'cost' | 'tokens' | 'events'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'Recent' },
  { key: 'cost', label: 'Spend' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'events', label: 'Requests' },
]
const LEDGER_PAGE = 14
const LEDGER_COLUMNS = 'md:grid-cols-[minmax(7rem,0.8fr)_4rem_minmax(0,2fr)_5.5rem_5.5rem_minmax(9rem,1fr)_1rem]'

function DailyTable({ snapshot }: { snapshot: WebSnapshot }) {
  const [sortKey, setSortKey] = React.useState<SortKey>('date')
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [visible, setVisible] = React.useState(LEDGER_PAGE)
  const todayKey = snapshot.generated.slice(0, 10)

  const detailByDate = React.useMemo(() => {
    const map = new Map<string, WebSnapshot['dailyBySourceModel']>()
    for (const row of snapshot.dailyBySourceModel) {
      const rows = map.get(row.date) ?? []
      rows.push(row)
      map.set(row.date, rows)
    }
    for (const rows of map.values()) rows.sort((a, b) => b.costUSD - a.costUSD || totalTokens(b.tokens) - totalTokens(a.tokens))
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
  const maxCost = maxOf(rows.map((day) => day.costUSD))

  return (
    <Card>
      <CardHeader className="gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow">04 / Ledger</div>
          <CardTitle className="mt-2 text-2xl">Daily details</CardTitle>
          <CardDescription className="mt-1">
            {rows.length.toLocaleString()} active {rows.length === 1 ? 'day' : 'days'}. Open a day to see every tool and model.
          </CardDescription>
        </div>
        <TabsList aria-label="Sort days by">
          {SORTS.map((sort) => (
            <TabsTrigger key={sort.key} active={sortKey === sort.key} onClick={() => setSortKey(sort.key)}>
              {sort.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'hidden gap-3 px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground md:grid',
            LEDGER_COLUMNS,
          )}
        >
          <span>Day</span>
          <span>Tools</span>
          <span>Models</span>
          <span className="text-right">Tokens</span>
          <span className="text-right">Requests</span>
          <span className="text-right">Spend</span>
          <span />
        </div>
        <div className="grid gap-1">
          {rows.slice(0, visible).map((day) => {
            const details = detailByDate.get(day.date) ?? []
            const topModels = [...new Set(details.map((detail) => detail.model))].slice(0, 2)
            const isOpen = expanded === day.date
            const date = new Date(`${day.date}T00:00:00.000Z`)
            return (
              <div
                key={day.date}
                className={cn(
                  'rounded-2xl border transition-colors',
                  isOpen ? 'border-border bg-white/[0.035]' : 'border-transparent hover:bg-white/[0.025]',
                )}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : day.date)}
                  className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-3 px-3 py-3 text-left', LEDGER_COLUMNS)}
                >
                  <span>
                    <span className="block font-heading text-sm font-medium">
                      {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                    </span>
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {day.date === todayKey ? 'Today' : day.date.slice(0, 4)}
                    </span>
                  </span>
                  <span className="hidden items-center md:flex">
                    {day.sources.map((source) => (
                      <span
                        key={source}
                        title={SOURCE_LABELS[source]}
                        className="-ml-1 size-3 rounded-full ring-2 ring-secondary-background first:ml-0"
                        style={{ backgroundColor: SOURCE_COLORS[source] }}
                      />
                    ))}
                  </span>
                  <span className="hidden min-w-0 items-center gap-1.5 md:flex">
                    {topModels.map((model) => (
                      <span
                        key={model}
                        className="min-w-0 truncate rounded-full border border-border bg-white/[0.03] px-2 py-0.5 text-xs font-medium"
                      >
                        {shortModel(model)}
                      </span>
                    ))}
                    {day.models.length > topModels.length ? (
                      <span className="shrink-0 text-xs text-muted-foreground">+{day.models.length - topModels.length}</span>
                    ) : null}
                  </span>
                  <span className="hidden text-right font-heading text-sm tabular-nums md:block">
                    {formatCompactTokens(totalTokens(day.tokens))}
                  </span>
                  <span className="hidden text-right font-heading text-sm tabular-nums text-muted-foreground md:block">
                    {formatNumber(day.eventCount)}
                  </span>
                  <span className="flex items-center justify-end gap-3">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06] lg:block">
                      <span
                        className="bar-grow block h-full rounded-full bg-main"
                        style={{ width: `${Math.max(3, (day.costUSD / maxCost) * 100)}%` }}
                      />
                    </span>
                    <span className="font-heading text-sm font-medium tabular-nums">{formatUsd(day.costUSD)}</span>
                  </span>
                  <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen ? <DayBreakdown details={details} dayCost={day.costUSD} /> : null}
              </div>
            )
          })}
        </div>
        {rows.length > LEDGER_PAGE ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <span>
              Showing {Math.min(visible, rows.length).toLocaleString()} of {rows.length.toLocaleString()} days
            </span>
            <div className="flex gap-2">
              {visible < rows.length ? (
                <>
                  <Button variant="neutral" size="sm" onClick={() => setVisible((count) => count + 30)}>
                    Show 30 more
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setVisible(rows.length)}>
                    Show all
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setVisible(LEDGER_PAGE)}>
                  Show less
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function DayBreakdown({ details, dayCost }: { details: WebSnapshot['dailyBySourceModel']; dayCost: number }) {
  return (
    <div className="rise-in grid gap-0.5 border-t border-border px-3 pb-3 pt-2" style={{ animationDuration: '350ms' }}>
      {details.map((detail) => (
        <div
          key={`${detail.source}:${detail.model}`}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-xs md:grid-cols-[7.5rem_minmax(0,1fr)_minmax(5rem,1fr)_5rem_5rem_6rem]"
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: SOURCE_COLORS[detail.source] }} />
            {SOURCE_LABELS[detail.source]}
          </span>
          <span className="truncate font-medium max-md:order-first max-md:col-span-2">{shortModel(detail.model)}</span>
          <span className="hidden h-1 overflow-hidden rounded-full bg-white/[0.06] md:block">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${dayCost > 0 ? Math.max(2, (detail.costUSD / dayCost) * 100) : 0}%`,
                backgroundColor: SOURCE_COLORS[detail.source],
              }}
            />
          </span>
          <span className="hidden text-right tabular-nums md:block">{formatCompactTokens(totalTokens(detail.tokens))}</span>
          <span className="hidden text-right tabular-nums text-muted-foreground md:block">
            {formatNumber(detail.eventCount)} req
          </span>
          <span className="text-right font-heading tabular-nums">{formatUsd(detail.costUSD)}</span>
        </div>
      ))}
    </div>
  )
}
