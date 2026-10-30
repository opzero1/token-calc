import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';
import { openDotSessions, type OpenCodeSession } from './open-dot.js';

const DEFAULT_OPEN_CODE_PATH = path.join(homedir(), '.local', 'share', 'opencode');

type TableCache = { revisions: Map<string, string>; records: Map<string, OpenCodeRecord> };
type DatabaseCache = { identity: string; fingerprint: string; tables: Map<string, TableCache>; sessions: OpenCodeSession[] };
const databaseCache = new Map<string, DatabaseCache>();

type OpenCodeRecord = {
	id: string;
	format: 'legacy' | 'v2';
	event: UnifiedTokenEvent;
};

const USAGE_QUERIES = [
	{
		format: 'legacy',
		messageCounts: 'SELECT session_id, count(*) AS messages FROM message GROUP BY session_id',
		sql: `SELECT id,
		             session_id,
		             time_created,
		             json_extract(data, '$.providerID') AS provider_id,
		             json_extract(data, '$.modelID') AS model_id,
		             json_extract(data, '$.tokens.input') AS input_tokens,
		             json_extract(data, '$.tokens.output') AS output_tokens,
		             json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
		             json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
		             json_extract(data, '$.tokens.cache.write') AS cache_write_tokens,
		             json_extract(data, '$.cost') AS cost
		      FROM message
		      WHERE CASE
		              WHEN json_valid(data) THEN json_type(data, '$.tokens') = 'object'
		              ELSE 0
		            END`,
	},
	{
		format: 'v2',
		messageCounts: `SELECT session_id, count(*) AS messages FROM session_message WHERE type = 'assistant' GROUP BY session_id`,
		sql: `SELECT id,
		             session_id,
		             time_created,
		             json_extract(data, '$.model.providerID') AS provider_id,
		             json_extract(data, '$.model.id') AS model_id,
		             json_extract(data, '$.tokens.input') AS input_tokens,
		             json_extract(data, '$.tokens.output') AS output_tokens,
		             json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
		             json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
		             json_extract(data, '$.tokens.cache.write') AS cache_write_tokens,
		             json_extract(data, '$.cost') AS cost
		      FROM session_message
		      WHERE type = 'assistant'
		        AND CASE
		              WHEN json_valid(data) THEN
		                json_type(data, '$.tokens') = 'object'
		                AND json_extract(data, '$.model.providerID') IS NOT NULL
		                AND json_extract(data, '$.model.id') IS NOT NULL
		              ELSE 0
		            END`,
	},
] satisfies ReadonlyArray<{ format: OpenCodeRecord['format']; messageCounts: string; sql: string }>;

function getOpenCodePath(): string | null {
	const envPath = (process.env.OPENCODE_DATA_DIR ?? '').trim();
	if (envPath !== '') {
		const resolved = path.resolve(envPath);
		if (existsSync(resolved)) return resolved;
	}
	if (existsSync(DEFAULT_OPEN_CODE_PATH)) return DEFAULT_OPEN_CODE_PATH;
	return null;
}

function parseOpenCodeEvent(
	msg: Record<string, unknown>,
	fallbackSessionId?: string,
	fallbackCreatedMs?: number,
): UnifiedTokenEvent | null {
	const sessionId = String(msg.sessionID ?? fallbackSessionId ?? '');
	if (!sessionId) return null;

	const providerID = msg.providerID as string | undefined;
	const modelID = msg.modelID as string | undefined;
	if (!providerID || !modelID) return null;

	const tokens = msg.tokens as Record<string, unknown> | undefined;
	if (!tokens) return null;

	const input = Number(tokens.input ?? 0);
	const output = Number(tokens.output ?? 0);
	const cache = tokens.cache as Record<string, unknown> | undefined;
	const cacheCreation = Number(cache?.write ?? 0);
	const cacheRead = Number(cache?.read ?? 0);
	const reasoning = Number(tokens.reasoning ?? 0);
	if (input === 0 && output === 0 && cacheCreation === 0 && cacheRead === 0 && reasoning === 0) return null;

	const time = msg.time as Record<string, unknown> | undefined;
	const createdMs = Number(time?.created ?? fallbackCreatedMs ?? Date.now());

	return {
		source: 'opencode',
		timestamp: new Date(createdMs).toISOString(),
		sessionId,
		model: modelID,
		tokens: {
			input,
			output,
			cacheCreation,
			cacheRead,
			reasoning,
		},
		costUSD: typeof msg.cost === 'number' ? msg.cost : 0,
	};
}

async function loadOpenCodeEventsFromDb(dbPath: string): Promise<OpenCodeRecord[] | null> {
	if (dbPath === ':memory:' || !existsSync(dbPath)) return null;

	try {
		const info = await stat(dbPath, { bigint: true });
		const identity = `${info.dev}:${info.ino}`;
		const fingerprint = (await Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-journal`].map(async (file) => {
			try {
				const value = await stat(file, { bigint: true });
				return `${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '-';
				throw error;
			}
		}))).join('|');
		const previous = databaseCache.get(dbPath);
		const fresh = previous?.identity === identity;
		const attribute = (cached: DatabaseCache) => {
			const dots = openDotSessions(cached.sessions);
			return [...cached.tables.values()].flatMap((table) => [...table.records.values()].map((record) => ({
				...record, event: { ...record.event, tokens: { ...record.event.tokens }, openDot: dots.get(record.event.sessionId) },
			})));
		};
		if (fresh && previous.fingerprint === fingerprint) return attribute(previous);
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			db.exec('BEGIN');
			const tables = new Map<string, TableCache>();
			let readable = false;

			for (const query of USAGE_QUERIES) {
				try {
					const sessionTable = query.format === 'v2' && db.prepare('PRAGMA table_info(session_v2)').all().length ? 'session_v2' : 'session';
					const sessionColumns = db.prepare(`PRAGMA table_info(${sessionTable})`).all().map((column) => String(column.name));
					const incremental = sessionColumns.includes('time_updated');
					const revisions = new Map<string, string>();
					if (incremental) {
						// OpenCode keeps session totals in step with message usage; message counts also catch rows added or removed without them.
						const messageCounts = new Map<string, number>();
						for (const row of db.prepare(query.messageCounts).iterate()) messageCounts.set(String(row.session_id), Number(row.messages));
						const columns = ['id', 'time_updated', 'cost', 'tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write'].filter((column) => sessionColumns.includes(column));
						for (const row of db.prepare(`SELECT ${columns.join(', ')} FROM ${sessionTable}`).iterate()) {
							revisions.set(String(row.id), JSON.stringify({ ...row, messages: messageCounts.get(String(row.id)) ?? 0 }));
						}
					}
					const cached = fresh && incremental ? previous.tables.get(query.format) : undefined;
					const records = new Map(cached?.records);
					const changed = cached ? [...revisions].filter(([id, revision]) => cached.revisions.get(id) !== revision).map(([id]) => id) : undefined;
					for (const [id, record] of records) if (!revisions.has(record.event.sessionId) && incremental) records.delete(id);
					const parse = (row: Record<string, unknown>) => {
						const id = String(row.id ?? '');
						if (!id) return;

						const event = parseOpenCodeEvent(
							{
								providerID: row.provider_id,
								modelID: row.model_id,
								tokens: {
									input: row.input_tokens,
									output: row.output_tokens,
									reasoning: row.reasoning_tokens,
									cache: {
										read: row.cache_read_tokens,
										write: row.cache_write_tokens,
									},
								},
								cost: row.cost,
							},
							String(row.session_id ?? ''),
							row.time_created == null ? undefined : Number(row.time_created),
						);
						if (event) records.set(id, { id, format: query.format, event });
					};
					if (changed && changed.length < 1_000) {
						const changedIDs = new Set(changed);
						for (const [id, record] of records) if (changedIDs.has(record.event.sessionId)) records.delete(id);
						if (changed.length > 0) {
							const statement = db.prepare(`${query.sql} AND session_id = ?`);
							for (const id of changed) {
								for (const row of statement.iterate(id)) parse(row);
							}
						}
					} else {
						records.clear();
						for (const row of db.prepare(query.sql).iterate()) parse(row);
					}
					tables.set(query.format, { revisions, records });
					readable = true;
				} catch { /* Older databases may contain only one message format. */ }
			}

			const sessions: OpenCodeSession[] = [];
			for (const table of ['session', 'session_v2']) {
				try {
					const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name));
					const metadata = columns.includes('metadata') ? `CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.opThreads.coordinatorID') END` : 'NULL';
					for (const row of db.prepare(`SELECT id, title, directory, coalesce(parent_id, ${metadata}) AS parent_id FROM ${table}`).iterate()) {
						sessions.push({ id: String(row.id), title: String(row.title ?? ''), directory: String(row.directory ?? ''), parent_id: row.parent_id == null ? null : String(row.parent_id) });
					}
				} catch { /* Usage can be imported without session metadata. */ }
			}
			db.exec('COMMIT');
			if (!readable) return null;
			const cached: DatabaseCache = { identity, fingerprint, tables, sessions };
			databaseCache.set(dbPath, cached);
			return attribute(cached);
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

export async function loadOpenCodeEvents(): Promise<UnifiedTokenEvent[]> {
	const basePath = getOpenCodePath();
	const override = (process.env.OPENCODE_DB ?? '').trim();
	const dbPaths: string[] = [];

	if (override !== '') {
		if (override !== ':memory:') {
			const relativeBase = basePath ?? DEFAULT_OPEN_CODE_PATH;
			dbPaths.push(path.isAbsolute(override) ? override : path.resolve(relativeBase, override));
		}
	} else if (basePath) {
		dbPaths.push(path.join(basePath, 'opencode.db'));
		const channelPaths = await glob('opencode-*.db', { cwd: basePath, absolute: true, onlyFiles: true });
		dbPaths.push(...channelPaths.sort());
	}

	const records = new Map<string, OpenCodeRecord>();
	for (const file of databaseCache.keys()) if (!dbPaths.includes(file)) databaseCache.delete(file);
	let readableDatabase = false;

	for (const dbPath of dbPaths) {
		const dbRecords = await loadOpenCodeEventsFromDb(dbPath);
		if (dbRecords === null) continue;
		readableDatabase = true;

		for (const record of dbRecords) {
			const existing = records.get(record.id);
			if (!existing || (existing.format === 'legacy' && record.format === 'v2')) {
				records.set(record.id, record);
			}
		}
	}

	if (!readableDatabase && basePath) {
		const messagesDir = path.join(basePath, 'storage', 'message');
		if (existsSync(messagesDir)) {
			const files = (await glob('**/*.json', { cwd: messagesDir, absolute: true })).sort();
			const seen = new Set<string>();

			for (const file of files) {
				let content: string;
				try {
					content = await readFile(file, 'utf-8');
				} catch {
					continue;
				}

				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(content);
				} catch {
					continue;
				}

				const id = String(msg.id ?? '');
				if (!id || seen.has(id)) continue;
				seen.add(id);

				const event = parseOpenCodeEvent(msg);
				if (event) records.set(id, { id, format: 'legacy', event });
			}
		}
	}

	return [...records.values()]
		.sort(
			(a, b) =>
				new Date(a.event.timestamp).getTime() - new Date(b.event.timestamp).getTime() ||
				a.id.localeCompare(b.id),
		)
		.map((record) => record.event);
}
