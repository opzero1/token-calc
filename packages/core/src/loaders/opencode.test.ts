import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDashboardData } from '../aggregator.js'

import { loadOpenCodeEvents } from './opencode.js'

let dataDir: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete process.env.OPENCODE_DATA_DIR
  delete process.env.OPENCODE_DB
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  dataDir = undefined
})

describe('loadOpenCodeEvents', () => {
  it.each(['session', 'session_v2'])('attributes dots, workers, observers and child sessions from %s without adding usage', async (table) => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir
    vi.stubEnv('OPEN_DOT_HOME', path.join(dataDir, 'dots-home'))
    const home = process.env.OPEN_DOT_HOME!
    const db = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    db.exec(`
      CREATE TABLE ${table} (id TEXT PRIMARY KEY, title TEXT, directory TEXT, parent_id TEXT, metadata TEXT);
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    `)
    const sessions = [
      ['dot', 'Dot: jojo', path.join(home, 'dots/jojo'), null, null],
      ['worker', 'jojo worker #1: task', '/project', null, null],
      ['observer', 'open-dot observer for jojo, job 1', path.join(home, 'observer/jojo'), null, null],
      ['child', 'Threads worker', '/project', null, JSON.stringify({ opThreads: { coordinatorID: 'worker' } })],
      ['unrelated', 'Regular session', '/project', null, null],
    ]
    for (const session of sessions) {
      db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?, ?)`).run(...session)
      db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
        session[0], session[0], 'assistant', 1_700_000_000_000, 1,
        JSON.stringify({ model: { providerID: 'openai', id: 'gpt-6.1-sol' }, cost: 1,
          tokens: { input: 100, output: 10, reasoning: 2, cache: { read: 20, write: 0 } } }),
      )
    }
    db.close()
    const events = await loadOpenCodeEvents()
    expect(events).toHaveLength(5)
    expect(events.find((event) => event.sessionId === 'dot')).toMatchObject({ openDot: { name: 'jojo', role: 'conversation' } })
    expect(events.find((event) => event.sessionId === 'worker')).toMatchObject({ openDot: { name: 'jojo', role: 'worker' } })
    expect(events.find((event) => event.sessionId === 'child')).toMatchObject({ openDot: { name: 'jojo', role: 'worker' } })
    expect(events.find((event) => event.sessionId === 'observer')).toMatchObject({ openDot: { name: 'jojo', role: 'observer' } })
    expect(events.find((event) => event.sessionId === 'unrelated')?.openDot).toBeUndefined()
    const dashboard = buildDashboardData(events)
    expect(dashboard.totals.costUSD).toBe(5)
    expect(dashboard.bySource).toHaveLength(1)
    expect(dashboard.byOpenDot).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'jojo', role: 'conversation', costUSD: 1, eventCount: 1 }),
      expect.objectContaining({ name: 'jojo', role: 'worker', costUSD: 2, eventCount: 2 }),
      expect.objectContaining({ name: 'jojo', role: 'observer', costUSD: 1, eventCount: 1 }),
    ]))
    expect(dashboard.byOpenDot.reduce((sum, dot) => sum + dot.costUSD, 0)).toBe(4)
  })

  it('reloads only sessions whose revision or message count changed, without periodic full rescans', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir
    const db = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    db.exec(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY, time_updated INTEGER, cost REAL);
      CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, data TEXT)`)
    const message = (input: number) => JSON.stringify({ model: { providerID: 'openai', id: 'model' },
      tokens: { input, output: 0, cache: { read: 0, write: 0 } } })
    const insert = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?)')
    db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?)').run('s', 1, 0)
    insert.run('m', 's', 'assistant', 1_700_000_000_000, message(10))
    expect((await loadOpenCodeEvents())[0].tokens.input).toBe(10)
    const queries = vi.spyOn(DatabaseSync.prototype, 'prepare')
    const usageQueries = () => {
      const sql = queries.mock.calls.map(([statement]) => statement).filter((statement) => statement.includes('FROM session_message') && statement.includes('json_extract'))
      queries.mockClear()
      return sql
    }

    db.prepare('UPDATE session_message SET data = ? WHERE id = ?').run(message(20), 'm')
    db.prepare('UPDATE session_v2 SET cost = ? WHERE id = ?').run(1, 's')
    expect((await loadOpenCodeEvents())[0].tokens.input).toBe(20)
    expect(usageQueries()).toEqual([expect.stringContaining('AND session_id = ?')])

    insert.run('n', 's', 'assistant', 1_700_000_001_000, message(5))
    expect((await loadOpenCodeEvents()).map((event) => event.tokens.input)).toEqual([20, 5])
    expect(usageQueries()).toEqual([expect.stringContaining('AND session_id = ?')])

    db.prepare('DELETE FROM session_message WHERE id = ?').run('m')
    expect((await loadOpenCodeEvents()).map((event) => event.tokens.input)).toEqual([5])
    expect(usageQueries()).toEqual([expect.stringContaining('AND session_id = ?')])

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60 * 60_000)
    insert.run('u', 's', 'user', 1_700_000_002_000, '{}')
    expect((await loadOpenCodeEvents()).map((event) => event.tokens.input)).toEqual([5])
    expect(usageQueries()).toEqual([])
    db.close()
  })

  it('refreshes updated, deleted and backfilled messages and isolates cached events', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir
    const db = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    db.exec(`CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)`)
    const insert = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)')
    const message = (input: number) => JSON.stringify({ model: { providerID: 'openai', id: 'gpt-6.1-sol' },
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 1 })
    insert.run('first', 'session', 'assistant', 1_700_000_000_000, 1, message(100))
    const first = await loadOpenCodeEvents()
    first[0].tokens.input = 999
    first[0].costUSD = 999
    expect((await loadOpenCodeEvents())[0]).toMatchObject({ tokens: { input: 100 }, costUSD: 1 })
    db.prepare('UPDATE session_message SET data = ?, time_updated = 2 WHERE id = ?').run(message(200), 'first')
    expect((await loadOpenCodeEvents())[0].tokens.input).toBe(200)
    insert.run('backfill', 'session', 'assistant', 1_600_000_000_000, 1, message(50))
    expect(await loadOpenCodeEvents()).toHaveLength(2)
    db.prepare('DELETE FROM session_message WHERE id = ?').run('first')
    expect((await loadOpenCodeEvents()).map((event) => event.tokens.input)).toEqual([50])
    db.close()
  })

  it('loads token-bearing assistant messages without treating user messages as usage', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir

    const db = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)')
    insert.run(
      'assistant',
      'session-1',
      1_700_000_000_000,
      JSON.stringify({
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-5',
        time: { created: 1_700_000_000_000 },
        tokens: { input: 120, output: 30, reasoning: 5, cache: { read: 10, write: 2 } },
        cost: 0.42,
      }),
    )
    insert.run(
      'user',
      'session-1',
      1_700_000_000_001,
      JSON.stringify({
        role: 'user',
        content: 'tokens shown in a prompt are not usage records',
      }),
    )
    db.close()

    const events = await loadOpenCodeEvents()

    expect(events).toEqual([
      expect.objectContaining({
        source: 'opencode',
        sessionId: 'session-1',
        model: 'gpt-5',
        tokens: { input: 120, output: 30, reasoning: 5, cacheRead: 10, cacheCreation: 2 },
        costUSD: 0.42,
      }),
    ])
  })

  it('merges legacy and V2 usage from channel databases without double counting', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir

    const db = new DatabaseSync(path.join(dataDir, 'opencode-local.db'))
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)

    const insertLegacy = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)')
    insertLegacy.run(
      'legacy-only',
      'session-legacy',
      1_700_000_000_100,
      JSON.stringify({
        role: 'assistant',
        providerID: 'openai',
        modelID: 'gpt-4',
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.1,
      }),
    )
    insertLegacy.run(
      'shared',
      'session-shared',
      1_700_000_000_200,
      JSON.stringify({
        role: 'assistant',
        providerID: 'openai',
        modelID: 'legacy-model',
        tokens: { input: 20, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.2,
      }),
    )
    insertLegacy.run(
      'legacy-shadowed',
      'session-shadowed',
      1_700_000_000_300,
      JSON.stringify({
        role: 'assistant',
        providerID: 'anthropic',
        modelID: 'claude-legacy',
        tokens: { input: 30, output: 6, reasoning: 1, cache: { read: 2, write: 0 } },
        cost: 0.3,
      }),
    )

    const insertV2 = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)')
    insertV2.run(
      'shared',
      'session-shared',
      'assistant',
      1,
      1_700_000_000_200,
      JSON.stringify({
        model: { providerID: 'openai', id: 'v2-model' },
        tokens: { input: 25, output: 5, reasoning: 2, cache: { read: 3, write: 1 } },
        cost: 0.25,
      }),
    )
    insertV2.run(
      'legacy-shadowed',
      'session-shadowed',
      'user',
      2,
      1_700_000_000_300,
      JSON.stringify({ text: 'This row must not hide the legacy usage record.' }),
    )
    insertV2.run(
      'v2-only',
      'session-v2',
      'assistant',
      3,
      1_700_000_000_400,
      JSON.stringify({
        model: { providerID: 'anthropic', id: 'claude-v2' },
        tokens: { input: 40, output: 8, reasoning: 3, cache: { read: 4, write: 2 } },
        cost: 0.4,
      }),
    )
    insertV2.run(
      'cross-db',
      'session-cross-db',
      'assistant',
      4,
      1_700_000_000_350,
      JSON.stringify({
        model: { providerID: 'openai', id: 'cross-db-v2' },
        tokens: { input: 35, output: 7, reasoning: 1, cache: { read: 3, write: 0 } },
        cost: 0.35,
      }),
    )
    insertV2.run('malformed', 'session-v2', 'assistant', 5, 1_700_000_000_500, '{')
    db.close()

    const defaultDb = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    defaultDb.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    defaultDb.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
      'cross-db',
      'session-cross-db',
      1_700_000_000_350,
      JSON.stringify({
        role: 'assistant',
        providerID: 'openai',
        modelID: 'cross-db-legacy',
        tokens: { input: 30, output: 6, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.3,
      }),
    )
    defaultDb.close()

    const events = await loadOpenCodeEvents()

    expect(events).toEqual([
      expect.objectContaining({ sessionId: 'session-legacy', model: 'gpt-4' }),
      expect.objectContaining({
        sessionId: 'session-shared',
        model: 'v2-model',
        tokens: { input: 25, output: 5, reasoning: 2, cacheRead: 3, cacheCreation: 1 },
        costUSD: 0.25,
      }),
      expect.objectContaining({ sessionId: 'session-shadowed', model: 'claude-legacy' }),
      expect.objectContaining({ sessionId: 'session-cross-db', model: 'cross-db-v2' }),
      expect.objectContaining({ sessionId: 'session-v2', model: 'claude-v2' }),
    ])
  })

  it('honors a relative OPENCODE_DB override', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir
    process.env.OPENCODE_DB = 'custom.sqlite'

    const decoyDb = new DatabaseSync(path.join(dataDir, 'opencode.db'))
    decoyDb.exec(`
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    decoyDb.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
      'decoy',
      'session-decoy',
      'assistant',
      1,
      1_700_000_000_000,
      JSON.stringify({
        model: { providerID: 'openai', id: 'decoy-model' },
        tokens: { input: 99, output: 9, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.99,
      }),
    )
    decoyDb.close()

    const db = new DatabaseSync(path.join(dataDir, 'custom.sqlite'))
    db.exec(`
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        seq INTEGER NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `)
    db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)').run(
      'override',
      'session-override',
      'assistant',
      1,
      1_700_000_000_000,
      JSON.stringify({
        model: { providerID: 'openai', id: 'override-model' },
        tokens: { input: 12, output: 3, reasoning: 0, cache: { read: 1, write: 0 } },
        cost: 0.12,
      }),
    )
    db.close()

    const events = await loadOpenCodeEvents()

    expect(events).toEqual([
      expect.objectContaining({
        sessionId: 'session-override',
        model: 'override-model',
      }),
    ])
  })
})
