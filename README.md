# token-calc

token-calc is a local dashboard for seeing how many tokens your AI coding tools are using and what that usage roughly costs.

It reads usage data already stored on your machine by tools like Claude Code, Codex, Gemini, OpenCode, Amp, and Pi-Agent. It then normalizes those records into one view with daily spend, source breakdowns, top models, token mix, and recent usage.

Nothing needs to be uploaded anywhere. The web app and CLI both run locally.

Use Node.js 24 or newer for the web app and a current Bun release for the CLI. Codex compressed histories need the runtime's built-in Zstandard support.

## How It Works

1. token-calc scans the usual local data folders for supported AI coding tools.
2. Each loader turns tool-specific records into a shared token event format.
3. Missing costs are estimated from LiteLLM model pricing, with a small offline fallback.
4. Events are aggregated by day, source, model, project, and token type.
5. The result is shown in either the browser dashboard or the terminal UI.

The numbers are meant for visibility and budgeting, not billing reconciliation. If a tool already records cost, token-calc uses that value. Otherwise it estimates cost from model pricing.

Codex ingestion covers active and archived `.jsonl` and `.jsonl.zst` histories. Plain files take precedence over compressed siblings, and copied sessions count once. Cached input and reasoning output are separated from input and output so token totals don't count them twice. Separately counted reasoning uses the output price when estimating cost.

## open-dot attribution

The web dashboard and CLI show usage by dot and role: conversation, worker, or observer. This usage is already included under OpenCode, not added as another source.

Attribution uses OpenCode session directories, known dot worker titles, and parent or Threads coordinator relationships. It does not read open-dot's database or call its API. Renamed or moved sessions can lose attribution; sessions a dot only watches are not automatically attributed.

The default home is `~/.opendot`. Set `OPEN_DOT_HOME` if your dots live elsewhere.

## Ingestion performance

The first scan still reads historical data. Later scans in the same process reuse unchanged Codex files and OpenCode sessions. OpenCode rereads only sessions whose usage totals, update time, or assistant message count changed, and reads the whole database again only when the file is replaced or a thousand or more sessions change between scans. Source databases remain read-only.

Snapshot requests made within ten seconds of a scan reuse it, including requests for other ranges. Dashboard snapshots expire ten seconds after the scan they came from; expired requests wait for fresh data. Only events in the selected period need cost enrichment. A new CLI process starts with cold caches.

Measure three scans in one process:

```bash
pnpm bench:ingest
```

The benchmark reports durations, event counts, and failed source names, without session paths, titles, or message content. It excludes pricing and dashboard aggregation. "Cold" means an empty process cache, not an empty operating-system disk cache.

## Web Dashboard

Install dependencies and start the local web app:

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:6767`.

The dashboard includes range filters for 7 days, 30 days, 90 days, 180 days, 1 year, and all time. It loads the selected range first, then calculates the other ranges in the background, so switching ranges doesn't wait for a scan. The selected range refreshes every minute; another range refreshes when you open it, if its data is more than a minute old.

The browser keeps the last snapshot of each range in IndexedDB. On later visits the page shows that saved data immediately, marked as saved in the header, and replaces it when the scan finishes. A browser with no saved data shows the page layout right away but waits for the first scan, which can take tens of seconds on a large history. The dev server starts that scan as soon as it starts listening, so a page opened a few minutes later loads from the warm caches.

The header shows a 3D skyline of the selected range, with one tower per day sized by spend. Hover a tower to see that day's spend, tokens, and requests, or drag to turn the skyline. The top bar shows the total number of indexed events, which rolls forward when a refresh finds new ones.

The daily chart follows the selected range. Ranges longer than 45 days show a 7-day average, with each day's total as a fainter line. The activity rhythm groups usage by weekday and hour in the time zone of the machine running token-calc.

## Terminal UI

The OpenTUI CLI runs with Bun:

```bash
pnpm --filter @token-calc/cli dev -- --range 30
```

Supported ranges are `7`, `30`, `90`, `180`, `365`, and `all`.

To see the cost, token, model, and source breakdown for one day:

```bash
pnpm --filter @token-calc/cli dev -- --date 2026-09-08
```

Dates use `YYYY-MM-DD` and cover midnight to midnight UTC, matching the dashboard's daily totals. The date view includes every model used that day.

To see usage from a date through now:

```bash
pnpm --filter @token-calc/cli dev -- --since 2026-09-01
```

`--since` starts at midnight UTC on the selected date. Use one of `--date`, `--since`, or `--range`.

To show token usage without costs, add `--no-cost`:

```bash
pnpm --filter @token-calc/cli dev -- --since 2026-09-01 --no-cost
```

This hides costs in every section and ranks sources by tokens. Summary cards use the selected period. Active days count only days with recorded usage, and daily averages use that count. Token totals include cache reads and writes.

Press `q` or `Ctrl+C` to exit.

## Supported Sources

token-calc currently scans:

- Claude Code
- Codex
- Gemini
- OpenCode
- Amp
- Pi-Agent

You can point token-calc at custom data locations with these environment variables:

- `CLAUDE_CONFIG_DIR`
- `CODEX_HOME`
- `GEMINI_DIR`
- `OPENCODE_DATA_DIR`
- `OPENCODE_DB` (select one OpenCode database instead of all installed channels)
- `OPEN_DOT_HOME` (attribution only)
- `AMP_DATA_DIR`
- `PI_AGENT_DIR`

## Useful Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm bench:ingest
pnpm --filter @token-calc/cli dev -- --range all
```

`pnpm dev` starts the Vite+ web dashboard. Build, lint, typecheck, and test commands run from the pnpm workspace root.
