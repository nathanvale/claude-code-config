---
name: review-impl
description: Review implemented work against a tech plan. Compares changes to the plan, catches regressions, identifies gaps. Use after implementing a feature.
allowed-tools: mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*, Bash(git:*), Bash(gh:*), Read, Glob, Grep, Skill, Task, AskUserQuestion, mcp__plugin_para-obsidian_para-obsidian__*
skills: codebase-search, deep-dive
context: fork
argument-hint: <POS-XXXX or PR-number>
---

# Review Implementation Against Plan

Compare implemented code changes against the original technical plan. Identifies gaps, scope creep, regressions, and AC coverage. Use after implementing a feature to verify completeness before creating a PR.

## Inputs

Parse from `$ARGUMENTS`:
- **Identifier** (required) — either a Jira ticket ID (e.g., `POS-3044`) or a PR number (e.g., `#435`)
- The identifier determines how to find the plan and the diff

## Workflow

### Phase 1: Parse Argument

Determine if the argument is:
- **Ticket ID** (matches `POS-\d+`) — use for Obsidian search + git diff
- **PR number** (matches `#?\d+`) — use for `gh pr diff` + extract ticket from PR title/body

### Phase 2: Load the Plan

Search Obsidian vault for the project note:

```
para_search({ query: "<TICKET_ID>", dir: "01 Projects", response_format: "json" })
```

If found:
```
para_read({ path: "<found note path>", response_format: "json" })
```

Extract from the plan:
- Acceptance criteria
- Implementation phases (with file lists and expected changes)
- Dependencies and blockers
- Key files table

If **not found**, ask via `AskUserQuestion`:
> "No Obsidian project note found for <ID>. Options:"
> - "Continue without plan (review code quality only)"
> - "Provide plan location"
> - "Skip review"

### Phase 3: Get Implementation Diff

For **ticket ID**:
```bash
git diff master...HEAD --stat
git diff master...HEAD
```

For **PR number**:
```bash
gh pr diff <number>
gh pr view <number> --json title,body,files
```

Extract the list of changed files from the diff.

### Phase 4: Search Changed Files

Run the codebase-search workflow (loaded via `skills: codebase-search`) scoped to the changed files:

- `REPO_PATH` = current working directory
- `QUERY` = ticket summary or PR title
- Focus search on the diff's changed files rather than broad codebase

This provides context on what the changed files export and how they connect.

### Phase 5: Deep Dive Changed Files

Select the most significant changed files (by diff size + relevance). Invoke:

```
Skill({ skill: "deep-dive", args: "<changed-file1> <changed-file2> --focus '<ticket summary>' --include-quality --include-tests" })
```

`--include-quality` is used here — this is a review, so we want code quality + bug findings.

### Phase 6: Compare Plan vs Implementation

For each **implementation phase** from the plan:
1. Check if the expected files were modified
2. Check if the expected changes were made (types added, hooks created, etc.)
3. Flag any files changed that weren't in the plan (potential scope creep)
4. Flag any planned changes that weren't implemented (gaps)

For each **acceptance criterion**:
1. Map to the implementation that satisfies it
2. Status: `Implemented`, `Partially Implemented`, `Not Implemented`, `Cannot Verify`
3. Note the specific code location that implements it

### Phase 7: Generate Report

Output using [COMPARISON_TEMPLATE.md](COMPARISON_TEMPLATE.md).

## Error Handling

| Scenario | Handling |
|----------|----------|
| No Obsidian note | Offer to continue with code-quality-only review |
| No diff (clean branch) | "No changes found on this branch vs master." |
| PR not found | "PR #<number> not found. Check the number or ensure you're in the right repo." |
| Plan has no phases | Skip phase comparison, focus on AC coverage |
| Deep dive fails | Present diff analysis with search results only |

## Output Contract

```
### Result
Implementation review for <KEY>: <N> phases checked, <N> gaps found, <N> regressions.

### Context for Caller
- status: pass|partial|fail
- operation: review-impl
- key: <KEY>
- phases_checked: <N>
- gaps: <N>
- regressions: <N>
- quality_score: <A-F>
```

### Babysitter Inbox Reporting

On transient failures, report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md):
- `obsidian_read_failed` — para_search or para_read fails during plan loading
- `deep_dive_failed` — deep-dive skill returns no results or times out

## Token Budget

- Plan loading: ~2k tokens
- Diff analysis: ~3k tokens
- codebase-search: ~2k tokens
- deep-dive (with quality): ~20k tokens
- Comparison synthesis: ~3k tokens
- **Total: ~30k tokens**
