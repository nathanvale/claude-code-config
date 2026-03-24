---
name: deep-dive
description: Deep analysis of specific files using parallel agents. Returns consolidated analysis of exports, state, patterns, test coverage, and quality issues. Not user-invocable — composed into workflow skills.
allowed-tools: Task, Read, Glob, Grep, mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*
context: fork
user-invocable: false
argument-hint: <file1> <file2> [--focus "topic"] [--include-quality] [--include-tests]
---

# Deep Dive

Thorough analysis of specific files using parallel Explore agents. Returns consolidated findings for the caller to integrate into plans, explanations, or reviews.

**This skill runs in a forked context** — isolates token cost and returns a summary.

## Pre-flight: Load MCP Tools

MCP tools are deferred. Load via `select:` before use (run in parallel):

```
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_index_overview" })
```

Explore sub-agents (Task tool) inherit loaded tools — they do NOT need to reload.

## Inputs

Parse from arguments:
- **File paths** (required) — 1-5 absolute file paths to analyze
- `--focus "topic"` (optional) — what to look for (ticket summary, feature name)
- `--include-quality` (optional) — also run code-reviewer + bug-hunter analysis
- `--include-tests` (optional) — include test file analysis in each exploration

## Workflow

### Phase 1: Parse Arguments

Extract file paths and flags from `$ARGUMENTS`. Validate:
- Files exist (use `Glob` to verify)
- Cap at 5 files — if more provided, take first 5 and note the rest were skipped

### Phase 2: Explore Files (parallel agents)

Launch one `Task` agent per file, all in parallel:

```
Task({
  subagent_type: "Explore",
  description: "Explore <filename>",
  prompt: <see EXPLORE_AGENT.md template>,
  run_in_background: true
})
```

Each agent receives the prompt from [EXPLORE_AGENT.md](EXPLORE_AGENT.md) with `{FILE_PATH}` and `{FOCUS_TOPIC}` substituted.

If `--include-tests`:
- Agent also reads the adjacent test file (`.test.tsx`, `.test.ts`, `.spec.ts`)
- Reports test coverage assessment

### Phase 3: Quality Analysis (conditional, parallel)

If `--include-quality` flag is set, launch these **in parallel with Phase 2**:

```
Task({
  subagent_type: "code-review:code-reviewer",
  description: "Review code quality",
  prompt: <see QUALITY_AGENTS.md — Code Reviewer section>,
  run_in_background: true
})

Task({
  subagent_type: "code-review:bug-hunter",
  description: "Hunt for bugs",
  prompt: <see QUALITY_AGENTS.md — Bug Hunter section>,
  run_in_background: true
})
```

Provide all file paths to both agents so they analyze the full set.

### Phase 4: Collect & Synthesize

Wait for all background agents to complete. Read their output files.

Produce consolidated output with these sections:

```markdown
## Deep Dive: <FOCUS_TOPIC or "File Analysis">

### Per-File Analysis

#### <file1>
- **Exports:** components, hooks, functions, types
- **State:** useState, useSelector, RTK Query hooks used
- **Data Flow:** props in → API calls → state updates → renders
- **Patterns:** relevant patterns found (RTK Query, MUI, etc.)
- **Interactions:** how this module connects to others
- **Test Coverage:** (if --include-tests) what's tested, what's missing
- **Issues:** code smells, potential problems

#### <file2>
...

### Cross-File Patterns
- Shared patterns across analyzed files
- Common state management approach
- Data flow between files

### Quality Summary (if --include-quality)

#### Code Review Findings
| Severity | File | Finding |
|----------|------|---------|
| ... | ... | ... |

#### Bug Hunt Findings
| Risk | File | Finding | Impact |
|------|------|---------|--------|
| ... | ... | ... | ... |

### Recommendations
- Key observations for the caller
- Pre-existing issues to be aware of
- Patterns to follow for new code
```

## Token Budget

- Per-file Explore agent: ~3k tokens (overview + read + test read)
- Code reviewer: ~2k tokens
- Bug hunter: ~2k tokens
- Synthesis: ~1k tokens
- **Total: ~20k tokens max (5 files + quality)**

## Error Handling

| Scenario | Handling |
|----------|----------|
| File not found | Skip file, note in output |
| No test file exists | Report "No test file found" in coverage section |
| Agent fails/times out | Continue with available results, note gap |
| Too many files (>5) | Take first 5, list skipped files |
