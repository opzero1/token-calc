import { appendFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { totalTokenCount } from '../types.js'
import { loadCodexEvents } from './codex.js'

let home: string
const timestamp = '2026-10-23T12:00:00Z'
const usage = (input = 100, cached = 60, output = 20, reasoning = 5, write = 10) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: write,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
})
const count = (total = usage(), last = total) => ({
  timestamp,
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
})
const lines = (id: string, entries: unknown[] = [count()]) =>
  [
    { type: 'session_meta', payload: { id, cwd: '/projects/example' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
    ...entries,
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n'

async function file(name: string, content: string) {
  const target = path.join(home, name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, name.endsWith('.zst') ? zstdCompressSync(content) : content)
  return target
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'token-calc-codex-'))
  vi.stubEnv('CODEX_HOME', home)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

describe('loadCodexEvents', () => {
  it('uses disjoint token categories, the real session ID, and project', async () => {
    await file('sessions/day/session.jsonl', lines('session-1'))
    const [event] = await loadCodexEvents()
    expect(event).toMatchObject({
      sessionId: 'session-1',
      model: 'gpt-6.1-sol',
      project: '/projects/example',
      tokens: { input: 30, cacheRead: 60, cacheCreation: 10, output: 15, reasoning: 5 },
    })
    expect(totalTokenCount(event.tokens)).toBe(120)
  })

  it('loads compressed active and archived histories, including an archive-only home', async () => {
    await file('archived_sessions/a.jsonl.zst', lines('archived'))
    expect(await loadCodexEvents()).toHaveLength(1)
    await file('sessions/b.jsonl.zst', lines('active'))
    expect((await loadCodexEvents()).map((event) => event.sessionId).sort()).toEqual(['active', 'archived'])
  })

  it('prefers plain files over compressed siblings and deduplicates copied sessions', async () => {
    await file('sessions/a.jsonl', lines('same'))
    await file('sessions/a.jsonl.zst', lines('same', [count(usage(999))]))
    await file('archived_sessions/copy.jsonl.zst', lines('same'))
    const events = await loadCodexEvents()
    expect(events).toHaveLength(1)
    expect(totalTokenCount(events[0].tokens)).toBe(120)
  })

  it('does not count repeated usage reports or lose deltas after a counter reset', async () => {
    await file(
      'sessions/a.jsonl',
      lines('reset', [
        count(),
        count(),
        count(usage(10, 0, 2, 0, 0)),
        count(usage(30, 0, 6, 0, 0), usage(20, 0, 4, 0, 0)),
      ]),
    )
    const events = await loadCodexEvents()
    expect(events).toHaveLength(3)
    expect(events.reduce((sum, event) => sum + totalTokenCount(event.tokens), 0)).toBe(156)
  })

  it('does not fabricate a default model for usage without model context', async () => {
    await file('sessions/a.jsonl', JSON.stringify(count()) + '\n')
    expect((await loadCodexEvents())[0].model).toBe('unknown')
  })

  it('refreshes appended, replaced, and archived files without leaking mutated events', async () => {
    const target = await file('sessions/a.jsonl', lines('a'))
    const first = await loadCodexEvents()
    first[0].costUSD = 999
    first[0].tokens.input = 999
    expect((await loadCodexEvents())[0]).toMatchObject({ costUSD: 0, tokens: { input: 30 } })
    await appendFile(target, JSON.stringify(count(usage(200, 120, 40, 10, 20))) + '\n')
    expect(await loadCodexEvents()).toHaveLength(2)
    await file('sessions/a.jsonl', lines('replacement'))
    expect((await loadCodexEvents())[0].sessionId).toBe('replacement')
    await mkdir(path.join(home, 'archived_sessions'))
    await rename(target, path.join(home, 'archived_sessions/a.jsonl'))
    expect(await loadCodexEvents()).toHaveLength(1)
  })

  it('ignores malformed lines but reports corrupt compressed histories instead of silently undercounting', async () => {
    await file('sessions/good.jsonl', lines('good', ['ignored', count()]) + '{partial')
    expect(await loadCodexEvents()).toHaveLength(1)
    await writeFile(path.join(home, 'sessions/bad.jsonl.zst'), 'not zstd')
    await expect(loadCodexEvents()).rejects.toThrow(/compressed|zstd|corrupt/i)
  })
})
