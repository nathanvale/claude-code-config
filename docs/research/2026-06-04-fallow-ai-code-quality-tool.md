# Fallow: Static-Intelligence Tool for AI-Generated Code, 2026-06

Purpose: capture Fallow's model, CLI surface, and agentic/CI integration as a candidate code-quality runner for AI workflows.

Source: [Web Dev Simplified, "This Tool Forces AI To Write Good Code"](https://www.youtube.com/watch?v=t3my5ByUhFU) (Kyle, 2026-06-02, ~19 min). Tool site: [fallow.tools](https://fallow.tools).

Note: auto-transcript mangles "Fallow" as fow/follow/allow; command spellings below are reconstructed from context, verify against `fallow.tools` before adoption.

## Bottom Line

- ESLint-shaped CLI built for the failure modes of AI-generated code: duplication, dead code, oversized functions, untested complexity.
- Static intelligence is free; runtime intelligence is paid. Static is the pitch.
- Ships JSON output, a VS Code extension, an agent skill, and a Git-diff `audit` mode for CI.
- Best fit: post-implementation self-review step for an agent, plus a CI gate on PR-introduced regressions.

## Problem It Targets

- Duplicated blocks copy-pasted across a file or codebase.
- Massive files and functions, hard to parse.
- Dead code left behind after refactors: unused files, exports never imported, unused types, unused deps.
- AI is bad at finding and fixing these itself.

## Report Sections

- **Dead code** — unused files, unused exports (e.g. an exported function never imported), unused types, unused dependencies (incl. test-only deps to move out of prod). Has autofix.
- **Duplication** (author's favorite) — every duplicated block with exact line ranges; plus **clone families**.
- **Complexity / health**:
  - Largest functions flagged (demo had a ~1500-line function).
  - **Cyclomatic complexity** — branch count (if/ternary/switch); one fn hit 115.
  - **Cognitive load** — readability cost of nesting; one hit 133.
  - **CRAP score** — complexity weighted by test coverage; complex+untested scores worst.
- **File health score** — derived from complexity, dead-code ratio, and import/export coupling. Higher is better.
- **Hotspots** — git-history frequency x complexity; frequently-changed complex files rank worst.
- **Refactoring targets** — ranked by return-on-effort.
- **Overall score** at the end.

## CLI Surface (reconstructed)

- `npx fallow` — full baseline report; auto-detects framework plugins (Vite, Next.js, TanStack, Tailwind, etc.).
- `npx fallow <section>` — run one section, e.g. `dead-code`, `health`, `dupes`. Can narrow metrics per section.
- `npx fallow --json` — structured output for agents; includes available actions and fix guidance.
- `npx fallow fix` — autofix easy issues (export/import changes, dead-code removal). Demo fixed ~20.
- `npx fallow init` — generate `fallow.json` config.
- `npx fallow audit` — compare current branch vs base (default `main`) and report only PR-introduced issues. This is the CI command.

## Configuration (`fallow.json`)

- Install as dev dependency for team sharing: `npm i -D fallow`.
- **`ignore`** section skips paths. Gotcha shown in video: omit leading `./` for matches to register.
  - Examples: ignore generated dirs (`source/data/productinfo`), tests (`**/tests/*`), TypeScript-generated files.
  - Intentionally-duplicated code (test fixtures, similar card/data definitions) is a common false positive worth ignoring.
- **Duplicate `mode`**:
  - `mild` (default) — matches identical variable names.
  - `semantic` — also catches renamed variables/strings. Recommendation: tune with mild, then switch to semantic.

## Inline Overrides

- File-level: `// fallow-ignore-file code-duplication` (type optional).
- Line-level: `// fallow-ignore-next-line unused-export`.
- Prefer config-file ignores over inline comments for anything non-one-off.

## VS Code Extension

- Mirrors the CLI report in a sidebar with inline indicators.
- Unused file -> "File is not reachable from any entry point."
- Unused export shown inline; remove `export` + save to clear.
- Duplicate highlighting; squiggle underlines mutable via "show all findings / clear mute."

## Agent + CI Integration

- Skill install: `npx skills add fallow-rs/fallow skills` (defaults, into project dir). Adds skill file to `agents/` folder; invoke via `/fallow`.
- Recommended agent workflow: agent implements feature, then runs Fallow to self-review and autocorrect against project policy.
- GitHub Actions: copy provided snippet; runs on push/PR, posts markdown findings in PR comments. Wraps `audit` so only PR-introduced regressions gate the merge.

## Relevance Here

- Candidate to slot beside existing code-quality runners (Biome, tsc, bun) for AI-heavy repos — duplication and dead-code detection that lint/types do not cover.
- `--json` + `audit` make it agent-native and CI-friendly without bespoke glue.
- Open question: overlap with existing `code-quality.md` runner table; would need MCP-runner parity or stay Bash-invoked.

## References

- Tool: https://fallow.tools
- Video: https://www.youtube.com/watch?v=t3my5ByUhFU
- Author's local-AI video: https://youtu.be/UngVdAsQEiU
