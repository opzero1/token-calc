import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { DashboardSnapshot, TimeRange } from '@token-calc/core'
import * as React from 'react'

import { Dashboard, DashboardLoading } from '@/components/dashboard'

const allowedRanges = new Set<TimeRange>(['7', '30', '90', '180', '365', 'all'])

function parseRange(value: unknown): TimeRange {
  return typeof value === 'string' && allowedRanges.has(value as TimeRange) ? (value as TimeRange) : '90'
}

const getDashboardSnapshot = createServerFn({ method: 'GET' })
  .inputValidator(parseRange)
  .handler(async ({ data }) => {
    const { loadDashboardSnapshot } = await import('@token-calc/core')
    return loadDashboardSnapshot(data)
  })

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const [range, setRange] = React.useState<TimeRange>('90')
  const [snapshot, setSnapshot] = React.useState<DashboardSnapshot | null>(null)
  const [isRefreshing, setIsRefreshing] = React.useState(true)
  const refreshId = React.useRef(0)

  const refresh = React.useCallback(
    async (nextRange: TimeRange = range) => {
      const id = ++refreshId.current
      setIsRefreshing(true)
      try {
        const next = await getDashboardSnapshot({ data: nextRange })
        if (id === refreshId.current) setSnapshot(next)
      } finally {
        if (id === refreshId.current) setIsRefreshing(false)
      }
    },
    [range],
  )

  const handleRangeChange = React.useCallback(
    (nextRange: TimeRange) => {
      setRange(nextRange)
    },
    [],
  )

  React.useEffect(() => {
    void refresh(range)

    const interval = window.setInterval(() => {
      void refresh(range)
    }, 60_000)

    return () => window.clearInterval(interval)
  }, [range, refresh])

  if (!snapshot) {
    return <DashboardLoading />
  }

  return (
    <Dashboard
      snapshot={snapshot}
      range={range}
      isRefreshing={isRefreshing}
      onRangeChange={handleRangeChange}
      onRefresh={() => void refresh(range)}
    />
  )
}
