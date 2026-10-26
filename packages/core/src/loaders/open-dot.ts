import { homedir } from 'node:os'
import path from 'node:path'
import type { UnifiedTokenEvent } from '../types.js'

type Attribution = NonNullable<UnifiedTokenEvent['openDot']>
export type OpenCodeSession = { id: string; title: string; directory: string; parent_id: string | null }

export function openDotSessions(sessions: OpenCodeSession[]): Map<string, Attribution> {
  const home = path.resolve(process.env.OPEN_DOT_HOME || path.join(homedir(), '.opendot'))
  const result = new Map<string, Attribution>()
  const names = new Set<string>()
  for (const session of sessions) {
    const [category, name, worker, ...extra] = path.relative(home, session.directory).split(path.sep)
    if (!name || extra.length) continue
    const role =
      category === 'dots' && !worker
        ? 'conversation'
        : category === 'observer' && !worker
          ? 'observer'
          : (category === 'work' && !worker) || (category === 'worktrees' && /^\d+$/.test(worker ?? ''))
            ? 'worker'
            : undefined
    if (role) {
      names.add(name)
      result.set(session.id, { name, role })
    }
  }
  for (const session of sessions) {
    const name = session.title.match(/^(.+) worker #\d+: /)?.[1]
    if (!result.has(session.id) && name && names.has(name)) result.set(session.id, { name, role: 'worker' })
  }
  const byID = new Map(sessions.map((session) => [session.id, session]))
  for (const session of sessions) {
    let current: OpenCodeSession | undefined = session
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      const inherited = result.get(current.id)
      if (inherited) {
        result.set(session.id, { ...inherited, role: current.id === session.id ? inherited.role : 'worker' })
        break
      }
      current = current.parent_id ? byID.get(current.parent_id) : undefined
    }
  }
  return result
}
