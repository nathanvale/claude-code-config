# Code Quality Runners

Use Agent Runner for Bun tests. Prefer MCP runners for lint, format, and type
checks when available. Always pass `response_format: "json"` to MCP tools.

## Tests

- `skills/test-runner/scripts/test-runner.sh`: Bun test pass/fail, repair, triage, and detail lookup.
- Pass Bun coverage args after `--`, for example `-- --coverage`.
- Use repair mode for hot-context failing files.
- Use triage mode for cold-context suite failures.
- Use detail lookup when the compact packet is too terse.

## Lint And Format

- `biome_lintCheck`: read-only lint/format diagnostics.
- `biome_lintFix`: auto-fix with `--write`.
- `biome_formatCheck`: formatting gate.

## Types

- `tsc_check`: `tsc --noEmit` from nearest config.

Exit codes: `0` success, `2` blocking error.

## Routing

- Use Agent Runner for Bun test gates and failure context.
- Use Biome MCP for lint and format gates.
- Use TypeScript MCP for type gates.
