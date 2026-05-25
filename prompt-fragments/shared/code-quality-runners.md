## Code Quality Runners

Three MCP runners handle code-quality checks. Prefer them over raw CLIs; they filter output for token efficiency and return structured results.

Always pass `response_format: "json"`.

- `bun_runTests`: suite-level test run (all or filtered by pattern).
- `bun_testFile`: focused debugging on one exact file path.
- `bun_testCoverage`: coverage summary (slower than `bun_runTests`).
- `biome_lintCheck`: read-only lint + format diagnostics after edits.
- `biome_lintFix`: auto-fix with `--write`; returns remaining issues.
- `biome_formatCheck`: format compliance only (CI / pre-commit gates).
- `tsc_check`: `tsc --noEmit` using nearest tsconfig.

Do not invoke `bun test`, `biome`, or `tsc` directly via shell when these runners are available.

Exit codes: `0` success, `2` blocking error (fix before proceeding).
