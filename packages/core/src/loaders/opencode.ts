import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { glob } from 'tinyglobby';
import type { UnifiedTokenEvent } from '../types.js';

const DEFAULT_OPEN_CODE_PATH = path.join(homedir(), '.local', 'share', 'opencode');

type OpenCodeRecord = {
	id: string;
	format: 'legacy' | 'v2';
	event: UnifiedTokenEvent;
};

const USAGE_QUERIES = [
	{
		format: 'legacy',
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
] satisfies ReadonlyArray<{ format: OpenCodeRecord['format']; sql: string }>;

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
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(dbPath, { readOnly: true });
		try {
			const records: OpenCodeRecord[] = [];
			let readable = false;

			for (const query of USAGE_QUERIES) {
				const start = records.length;
				try {
					for (const row of db.prepare(query.sql).iterate()) {
						const id = String(row.id ?? '');
						if (!id) continue;

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
						if (event) records.push({ id, format: query.format, event });
					}
					readable = true;
				} catch {
					records.length = start;
				}
			}

			return readable ? records : null;
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
