import { performance } from 'node:perf_hooks'
import { loadAll } from '../packages/core/src/loaders/index.js'

for (let run = 1; run <= 3; run++) {
  const start = performance.now()
  const { events, errors } = await loadAll(true)
  const counts: Record<string, number> = {}
  let attributed = 0
  for (const event of events) {
    counts[event.source] = (counts[event.source] ?? 0) + 1
    if (event.openDot) attributed++
  }
  console.log(
    JSON.stringify({
      run,
      cache: run === 1 ? 'cold (process)' : 'warm',
      milliseconds: Math.round(performance.now() - start),
      events: events.length,
      bySource: counts,
      openDotEvents: attributed,
      failedSources: errors.map(({ source }) => source),
    }),
  )
  if (errors.length > 0) process.exitCode = 1
}
