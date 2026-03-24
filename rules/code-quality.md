---
alwaysApply: true
---

## Code Quality Tools 

Three MCP plugins handle all code quality checks. **NEVER run `bun test`, `biome`, or `tsc` via Bash** — use these MCP tools instead. They filter output for token efficiency.

**Always pass `response_format: "json"`.**

### Testing (bun-runner)

| Tool | When |
|------|------|
| `bun_runTests` | Suite-level regression — all tests or filter by pattern |
| `bun_testFile` | Focused debugging — one exact file path |
| `bun_testCoverage` | Coverage summary (slower than `bun_runTests`) |

### Linting & Formatting (biome-runner)

| Tool | When |
|------|------|
| `biome_lintCheck` | Read-only lint + format diagnostics after edits |
| `biome_lintFix` | Auto-fix with `--write`, returns remaining issues |
| `biome_formatCheck` | Format compliance only (CI/pre-commit gates) |

### Type Checking (tsc-runner)

| Tool | When |
|------|------|
| `tsc_check` | `tsc --noEmit` using nearest tsconfig — after edits |

### Exit Codes

- `0` → success
- `2` → blocking error (must fix before proceeding)
