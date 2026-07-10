import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadOpenCodeEvents } from './opencode.js'

let dataDir: string | undefined

afterEach(async () => {
  delete process.env.OPENCODE_DATA_DIR
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
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
})
