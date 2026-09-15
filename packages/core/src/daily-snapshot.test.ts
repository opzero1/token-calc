import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { loadDailySnapshot, loadDashboardSnapshot } from './index.js'

let fixtureDir: string | undefined

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
})

it('loads a UTC day across sources, excludes neighboring days, and keeps every breakdown consistent', async () => {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'token-calc-day-'))
  const directories = {
    CLAUDE_CONFIG_DIR: 'claude',
    CODEX_HOME: 'codex',
    GEMINI_DIR: 'gemini',
    OPENCODE_DATA_DIR: 'opencode',
    AMP_DATA_DIR: 'amp',
    PI_AGENT_DIR: 'pi',
  }
  for (const [variable, directory] of Object.entries(directories)) {
    const location = path.join(fixtureDir, directory)
    await mkdir(location)
    vi.stubEnv(variable, location)
  }
  for (const directory of ['claude/projects/example', 'codex/sessions', 'gemini/tmp', 'opencode/storage/message']) {
    await mkdir(path.join(fixtureDir, directory), { recursive: true })
  }
  vi.stubEnv('OPENCODE_DB', '')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})))

  const rows = [
    { timestamp: '2024-02-28T23:59:59.999Z', model: 'before', costUSD: 100 },
    { timestamp: '2024-02-29T00:00:00.000Z', model: 'start', costUSD: 1 },
    { timestamp: '2024-03-01T07:59:59.999+08:00', model: 'end', costUSD: 2 },
    { timestamp: '2024-03-01T00:00:00.000Z', model: 'after', costUSD: 100 },
    { timestamp: '2024-02-29T00:00:00.000+08:00', model: 'offset-before', costUSD: 100 },
    { timestamp: '2024-02-29T23:00:00.000-01:00', model: 'offset-after', costUSD: 100 },
  ]
  await writeFile(path.join(fixtureDir, 'claude/projects/example/session.jsonl'), rows.map((row) => JSON.stringify({
    timestamp: row.timestamp,
    costUSD: row.costUSD,
    message: {
      model: row.model,
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 },
    },
  })).join('\n'))
  await writeFile(path.join(fixtureDir, 'opencode/storage/message/event.json'), JSON.stringify({
    id: 'event',
    sessionID: 'session',
    providerID: 'openai',
    modelID: 'opencode-model',
    time: { created: Date.parse('2024-02-29T12:00:00Z') },
    cost: 3,
    tokens: { input: 300, output: 30, reasoning: 5, cache: { read: 4, write: 0 } },
  }))

  const snapshot = await loadDailySnapshot('2024-02-29')
  expect(snapshot.errors).toEqual([])
  expect(snapshot.totals).toMatchObject({
    costUSD: 6,
    totalTokens: 569,
    eventCount: 3,
    activeDays: 1,
    tokens: { input: 500, output: 50, cacheCreation: 6, cacheRead: 8, reasoning: 5 },
  })
  expect(snapshot.daily.map((day) => day.date)).toEqual(['2024-02-29'])
  expect(snapshot.byModel.map((model) => model.model)).toEqual(['opencode-model', 'end', 'start'])
  expect(snapshot.bySource.map((source) => source.source)).toEqual(['opencode', 'claude-code'])
  expect(snapshot.byProject).toEqual([expect.objectContaining({ project: 'example', costUSD: 3, eventCount: 2 })])
  for (const rows of [snapshot.daily, snapshot.dailyBySource, snapshot.dailyByModel, snapshot.dailyBySourceModel,
    snapshot.monthly, snapshot.bySource, snapshot.byModel, snapshot.bySourceModel, snapshot.heatmap]) {
    expect(rows.reduce((sum, row) => sum + row.costUSD, 0)).toBe(6)
  }

  const empty = await loadDailySnapshot('2024-03-02')
  expect(empty.totals).toMatchObject({ costUSD: 0, totalTokens: 0, eventCount: 0, activeDays: 0 })
  expect(empty.byModel).toEqual([])
  expect(empty.bySource).toEqual([])
  expect(empty.daily).toEqual([])

  const all = await loadDashboardSnapshot('all')
  expect(all.totals.costUSD).toBe(406)
  expect(all.totals.eventCount).toBe(7)
})
