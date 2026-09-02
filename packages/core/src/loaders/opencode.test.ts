import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadOpenCodeEvents } from './opencode.js'

let dataDir: string | undefined

afterEach(async () => {
  delete process.env.OPENCODE_DATA_DIR
  delete process.env.OPENCODE_DB
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  dataDir = undefined
})

describe('loadOpenCodeEvents', () => {
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
    insertV2.run('malformed', 'session-v2', 'assistant', 4, 1_700_000_000_500, '{')
    db.close()

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
      expect.objectContaining({ sessionId: 'session-v2', model: 'claude-v2' }),
    ])
  })

  it('honors a relative OPENCODE_DB override', async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'token-calc-opencode-'))
    process.env.OPENCODE_DATA_DIR = dataDir
    process.env.OPENCODE_DB = 'custom.sqlite'

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
