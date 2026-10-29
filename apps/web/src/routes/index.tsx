import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { TimeRange } from '@token-calc/core'
import * as React from 'react'

import { Dashboard, type RangeState } from '@/components/dashboard'
import {
  readCachedSnapshots,
  toWebSnapshot,
  writeCachedSnapshot,
  type SnapshotMap,
  type WebSnapshot,
} from '@/lib/snapshot'

const allowedRanges = new Set<TimeRange>(['7', '30', '90', '180', '365', 'all'])
const BACKGROUND_ORDER: TimeRange[] = ['7', '30', '180', '365', 'all', '90']
const REFRESH_INTERVAL_MS = 60_000

function parseRange(value: unknown): TimeRange {
  return typeof value === 'string' && allowedRanges.has(value as TimeRange) ? (value as TimeRange) : '90'
}

const getDashboardSnapshot = createServerFn({ method: 'GET' })
  .inputValidator(parseRange)
  .handler(async ({ data }) => {
    const { loadDashboardSnapshot } = await import('@token-calc/core')
    return toWebSnapshot(await loadDashboardSnapshot(data))
  })

export const Route = createFileRoute('/')({
  component: Home,
})

function useDashboardSnapshots(range: TimeRange) {
  const [snapshots, setSnapshots] = React.useState<SnapshotMap>({})
  const [loading, setLoading] = React.useState<ReadonlySet<TimeRange>>(() => new Set())
  const [error, setError] = React.useState<string | null>(null)
  const fetchedAt = React.useRef(new Map<TimeRange, number>())
  const inFlight = React.useRef(new Map<TimeRange, Promise<void>>())

  const load = React.useCallback((target: TimeRange) => {
    const existing = inFlight.current.get(target)
    if (existing) return existing

    setLoading((current) => new Set(current).add(target))
    const request = getDashboardSnapshot({ data: target })
      .then((snapshot) => {
        fetchedAt.current.set(target, Date.now())
        setSnapshots((current) => ({ ...current, [target]: snapshot }))
        setError(null)
        void writeCachedSnapshot(snapshot)
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        inFlight.current.delete(target)
        setLoading((current) => {
          const next = new Set(current)
          next.delete(target)
          return next
        })
      })
    inFlight.current.set(target, request)
    return request
  }, [])

  const isStale = React.useCallback((target: TimeRange) => {
    const at = fetchedAt.current.get(target)
    return at === undefined || Date.now() - at >= REFRESH_INTERVAL_MS
  }, [])

  const initialRange = React.useRef(range)
  React.useEffect(() => {
    let cancelled = false

    void readCachedSnapshots().then((cached) => {
      if (cancelled) return
      setSnapshots((current) => ({ ...cached, ...current }))
    })

    async function warmAllRanges() {
      await load(initialRange.current)
      for (const target of BACKGROUND_ORDER) {
        if (cancelled) return
        if (isStale(target)) await load(target)
      }
    }
    void warmAllRanges()

    return () => {
      cancelled = true
    }
  }, [isStale, load])

  React.useEffect(() => {
    if (isStale(range)) void load(range)
    const interval = window.setInterval(() => void load(range), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [isStale, load, range])

  const stateOf = React.useCallback(
    (target: TimeRange): RangeState => ({
      loading: loading.has(target),
      live: fetchedAt.current.has(target),
      hasData: snapshots[target] !== undefined,
    }),
    [loading, snapshots],
  )

  return { snapshots, stateOf, error, refresh: load }
}

function Home() {
  const [range, setRange] = React.useState<TimeRange>('90')
  const { snapshots, stateOf, error, refresh } = useDashboardSnapshots(range)
  const eventCount = React.useMemo(() => {
    let latest: WebSnapshot | undefined
    for (const snapshot of Object.values(snapshots)) {
      if (snapshot && (!latest || snapshot.generated > latest.generated)) latest = snapshot
    }
    return latest?.totalEventCount ?? null
  }, [snapshots])

  return (
    <Dashboard
      snapshot={snapshots[range] ?? null}
      range={range}
      rangeState={stateOf}
      error={error}
      eventCount={eventCount}
      onRangeChange={setRange}
      onRefresh={() => void refresh(range)}
    />
  )
}
