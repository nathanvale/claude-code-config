# Code Quality Runners

Prefer MCP runners over raw CLIs when available. Always pass
`response_format: "json"`.

## Tests

- `bun_runTests`: suite or pattern run.
- `bun_testFile`: one exact test file.
- `bun_testCoverage`: coverage summary.

## Lint And Format

- `biome_lintCheck`: read-only lint/format diagnostics.
- `biome_lintFix`: auto-fix with `--write`.
- `biome_formatCheck`: formatting gate.

## Types

- `tsc_check`: `tsc --noEmit` from nearest config.

Exit codes: `0` success, `2` blocking error.
