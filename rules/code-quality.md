---
alwaysApply: true
---

## Code Quality Tools (Claude enforcement)

The full runner table lives in the shared startup surface (rendered into `AGENTS.md` as "Code Quality Runners"). This rule is the auto-applied enforcement layer for Claude.

**Hard rule:** NEVER run `bun test`, `biome`, or `tsc` via Bash. Use the MCP runner tools (`bun_runTests`, `bun_testFile`, `bun_testCoverage`, `biome_lintCheck`, `biome_lintFix`, `biome_formatCheck`, `tsc_check`).

**Always pass `response_format: "json"`** — these are machine-to-machine interfaces; markdown wastes tokens.

If a runner returns exit code `2`, treat it as blocking — fix before proceeding. Do not paper over failures by retrying or wrapping in `|| true`.
