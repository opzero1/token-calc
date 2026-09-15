# token-calc

token-calc is a local dashboard for seeing how many tokens your AI coding tools are using and what that usage roughly costs.

It reads usage data already stored on your machine by tools like Claude Code, Codex, Gemini, OpenCode, Amp, and Pi-Agent. It then normalizes those records into one view with daily spend, source breakdowns, top models, token mix, and recent usage.

Nothing needs to be uploaded anywhere. The web app and CLI both run locally.

## How It Works

1. token-calc scans the usual local data folders for supported AI coding tools.
2. Each loader turns tool-specific records into a shared token event format.
3. Missing costs are estimated from LiteLLM model pricing, with a small offline fallback.
4. Events are aggregated by day, source, model, project, and token type.
5. The result is shown in either the browser dashboard or the terminal UI.

The numbers are meant for visibility and budgeting, not billing reconciliation. If a tool already records cost, token-calc uses that value. Otherwise it estimates cost from model pricing.

## Web Dashboard

Install dependencies and start the local web app:

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:6767`.

The dashboard refreshes automatically and includes range filters for 7 days, 30 days, 90 days, 180 days, 1 year, and all time.

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

Dates use `YYYY-MM-DD` and cover midnight to midnight UTC, matching the dashboard's daily totals. The date view includes every model used that day. Use either `--date` or `--range`.

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
- `AMP_DATA_DIR`
- `PI_AGENT_DIR`

## Useful Commands

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @token-calc/cli dev -- --range all
```

`pnpm dev` starts the Vite+ web dashboard. Build, lint, typecheck, and test commands run from the pnpm workspace root.
