# token-calc

Local AI coding token usage and cost dashboard built with TanStack Start, Turbo, Tailwind CSS, and shadcn-style components.

## Run

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:6767`.

## CLI

The OpenTUI CLI runs with Bun:

```bash
npm --workspace @token-calc/cli run dev -- --range 30
```

Supported ranges are `7`, `30`, `90`, `180`, `365`, and `all`. Press `q` or `Ctrl+C` to exit.

## What It Scans

token-calc reads local usage data for Claude Code, Codex, Gemini, OpenCode, Amp, and Pi-Agent, enriches model costs from LiteLLM pricing with an offline fallback, and renders the dashboard locally.

Supported override environment variables:

- `CLAUDE_CONFIG_DIR`
- `CODEX_HOME`
- `GEMINI_DIR`
- `OPENCODE_DATA_DIR`
- `AMP_DATA_DIR`
- `PI_AGENT_DIR`

## Scripts

- `npm run dev` starts the Turbo dev task on port `6767`.
- `npm --workspace @token-calc/cli run dev -- --range 30` starts the OpenTUI CLI.
- `npm run build` builds the TanStack Start app.
- `npm run typecheck` runs TypeScript checks across workspaces.
