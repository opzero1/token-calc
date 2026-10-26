import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'
import { glob } from 'tinyglobby'
import type { UnifiedTokenEvent } from '../types.js'

type RawUsage = { input: number; cached: number; write: number; output: number; reasoning: number; total: number }
type FileCache = { revision: string; events: Promise<UnifiedTokenEvent[]> }
const cache = new Map<string, FileCache>()

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function normalizeUsage(value: unknown): RawUsage | null {
  if (!value || typeof value !== 'object') return null
  const raw = record(value)
  const input = number(raw.input_tokens)
  const output = number(raw.output_tokens)
  return {
    input,
    output,
    cached: number(raw.cached_input_tokens ?? raw.cache_read_input_tokens),
    write: number(raw.cache_write_input_tokens),
    reasoning: number(raw.reasoning_output_tokens),
    total: number(raw.total_tokens) || input + output,
  }
}

function extractModel(payload: Record<string, unknown>): string | undefined {
  const info = record(payload.info)
  for (const value of [
    info.model,
    info.model_name,
    record(info.metadata).model,
    payload.model,
    record(payload.metadata).model,
  ]) {
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

async function parseFile(file: string): Promise<UnifiedTokenEvent[]> {
  const events: UnifiedTokenEvent[] = []
  let sessionId = path.basename(file).replace(/\.jsonl(?:\.zst)?$/, '')
  let project: string | undefined
  let model: string | undefined
  let previous: RawUsage | null = null
  const source = createReadStream(file)
  const input = file.endsWith('.zst') ? source.pipe(createZstdDecompress()) : source
  // pipe() does not forward source failures to the decompressor/readline iterator.
  if (input !== source) source.on('error', (error) => input.destroy(error))
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"session_meta"'))
        continue
      let entry: Record<string, unknown>
      try {
        entry = record(JSON.parse(line))
      } catch {
        continue
      }
      const payload = record(entry.payload)
      if (entry.type === 'session_meta') {
        if (typeof payload.id === 'string' && payload.id) sessionId = payload.id
        if (typeof payload.cwd === 'string') project = payload.cwd
        model = extractModel(payload) ?? model
        continue
      }
      if (entry.type === 'turn_context') {
        model = extractModel(payload) ?? model
        continue
      }
      if (entry.type !== 'event_msg' || payload.type !== 'token_count') continue
      const info = record(payload.info)
      const total = normalizeUsage(info.total_token_usage)
      if (!total) continue
      const last = normalizeUsage(info.last_token_usage)
      const reset =
        previous !== null &&
        (total.input < previous.input || total.output < previous.output || total.total < previous.total)
      const raw =
        previous === null || reset
          ? (last ?? total)
          : {
              input: Math.max(0, total.input - previous.input),
              cached: Math.max(0, total.cached - previous.cached),
              write: Math.max(0, total.write - previous.write),
              output: Math.max(0, total.output - previous.output),
              reasoning: Math.max(0, total.reasoning - previous.reasoning),
              total: Math.max(0, total.total - previous.total),
            }
      previous = total
      model = extractModel(payload) ?? model
      if (typeof entry.timestamp !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))) continue
      if (raw.input === 0 && raw.output === 0) continue

      const cached = Math.min(raw.input, raw.cached)
      const write = Math.min(raw.input - cached, raw.write)
      const reasoning = Math.min(raw.output, raw.reasoning)
      events.push({
        source: 'codex',
        timestamp: entry.timestamp,
        sessionId,
        model: model ?? 'unknown',
        project,
        tokens: {
          input: raw.input - cached - write,
          output: raw.output - reasoning,
          cacheRead: cached,
          cacheCreation: write,
          reasoning,
        },
        costUSD: 0,
      })
    }
  } catch (error) {
    throw new Error(`Could not read ${file.endsWith('.zst') ? 'compressed ' : ''}Codex history: ${file}`, {
      cause: error,
    })
  } finally {
    lines.close()
    input.destroy()
    source.destroy()
  }
  return events
}

async function loadFile(file: string): Promise<UnifiedTokenEvent[]> {
  let revision: string
  try {
    const info = await stat(file, { bigint: true })
    revision = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const existing = cache.get(file)
  if (existing?.revision === revision) return existing.events
  const events = parseFile(file)
  cache.set(file, { revision, events })
  try {
    return await events
  } catch (error) {
    if (cache.get(file)?.events === events) cache.delete(file)
    throw error
  }
}

export async function loadCodexEvents(): Promise<UnifiedTokenEvent[]> {
  const codexDir = path.resolve(process.env.CODEX_HOME?.trim() || path.join(homedir(), '.codex'))
  if (!existsSync(codexDir)) return []
  const files = (
    await glob(
      [
        'sessions/**/*.jsonl',
        'sessions/**/*.jsonl.zst',
        'archived_sessions/**/*.jsonl',
        'archived_sessions/**/*.jsonl.zst',
      ],
      {
        cwd: codexDir,
        absolute: true,
        onlyFiles: true,
      },
    )
  ).sort(
    (a, b) =>
      Number(a.includes('/archived_sessions/')) - Number(b.includes('/archived_sessions/')) || a.localeCompare(b),
  )
  const present = new Set(files)
  for (const file of cache.keys()) if (!present.has(file)) cache.delete(file)
  const selected = files.filter((file) => !file.endsWith('.zst') || !present.has(file.slice(0, -4)))
  const batches = Array.from({ length: selected.length }, (): UnifiedTokenEvent[] => [])
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(4, selected.length) }, async () => {
      while (cursor < selected.length) {
        const index = cursor++
        batches[index] = await loadFile(selected[index])
      }
    }),
  )

  const events: UnifiedTokenEvent[] = []
  const seen = new Set<string>()
  for (const batch of batches) {
    const session = batch[0]?.sessionId
    if (!session || seen.has(session)) continue
    seen.add(session)
    for (const event of batch) {
      events.push({ ...event, tokens: { ...event.tokens } })
    }
  }
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}
