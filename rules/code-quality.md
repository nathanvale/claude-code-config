---
alwaysApply: true
---

## Code Quality Tools (Claude enforcement)

The full runner table lives in the shared startup surface (rendered into `AGENTS.md` as "Code Quality Runners"). This rule is the auto-applied enforcement layer for Claude.

**Hard rule:** NEVER run raw `bun test`, `biome`, or `tsc` via Bash. Use `skills/test-runner/scripts/test-runner.sh` for Bun tests. Use the MCP runner tools for Biome and TypeScript (`biome_lintCheck`, `biome_lintFix`, `biome_formatCheck`, `tsc_check`).

**Bun routing:** use Agent Runner compact, repair, triage, detail, and coverage paths from `context/bun-runner.md`.

**Always pass `response_format: "json"`** — these are machine-to-machine interfaces; markdown wastes tokens.

If a runner returns exit code `2`, treat it as blocking — fix before proceeding. Do not paper over failures by retrying or wrapping in `|| true`.
