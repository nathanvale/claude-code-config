## Code Quality Runners

Three MCP runners handle all code-quality checks. Always prefer them over running the underlying CLIs directly — they filter output for token efficiency and return structured results.

**Always pass `response_format: "json"`.**

| Runner | Tool | Use when |
|--------|------|----------|
| bun-runner | `bun_runTests` | Suite-level test run (all or filtered by pattern) |
| bun-runner | `bun_testFile` | Focused debugging — one exact file path |
| bun-runner | `bun_testCoverage` | Coverage summary (slower than `bun_runTests`) |
| biome-runner | `biome_lintCheck` | Read-only lint + format diagnostics after edits |
| biome-runner | `biome_lintFix` | Auto-fix with `--write`, returns remaining issues |
| biome-runner | `biome_formatCheck` | Format compliance only (CI / pre-commit gates) |
| tsc-runner | `tsc_check` | `tsc --noEmit` using nearest tsconfig — after edits |

Do not invoke `bun test`, `biome`, or `tsc` directly via shell when these runners are available.

Exit codes: `0` = success, `2` = blocking error (must fix before proceeding).
