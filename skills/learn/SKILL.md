---
name: learn
description: Explore and explain a codebase area. Use when you want to understand how a feature, module, or pattern works.
allowed-tools: mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*, Bash(git:*), Read, Glob, Grep, Skill, Task, AskUserQuestion
skills: codebase-search
context: fork
argument-hint: "<topic or file path>" [--repo path]
---

# Learn: Codebase Exploration & Explanation

Explore a codebase area and produce a clear, structured explanation. Designed for understanding — not reviewing or planning implementation.

## CRITICAL: Topic Anchoring

**Your topic is `$ARGUMENTS`.** Every phase must stay focused on this topic.

- Do NOT let the current git branch, working directory, or recent commits influence what you explore
- Do NOT drift to the branch's feature if the user asked about something else
- If search results return files unrelated to the topic, discard them
- When invoking codebase-search and deep-dive, use the user's exact topic as the query — not the branch name or ticket context

## Inputs

Parse from `$ARGUMENTS`:
- **Topic** (required) — a feature name, module path, concept, or question (e.g., "barcode scanning", "how does seller filtering work", "src/api/fulfilmentsApi.ts")
- `--repo <path>` (optional) — repo to explore. Defaults to current working directory.

## Workflow

**IMPORTANT: This is a 6-phase workflow. You MUST execute ALL phases sequentially — do not stop after search results. The final output is the Phase 5 synthesis, not the search table.**

Phase summary: Parse topic → Search → Narrow scope → Deep dive → Synthesize explanation → Offer next steps

### Phase 1: Understand Intent

1. Parse the topic from arguments — **this is what the user wants to learn about**
2. Confirm: does the topic match any branch/ticket context? If NOT, explicitly note: "The user's topic is '<topic>', which is unrelated to the current branch. Staying focused on the topic."
3. If the topic is ambiguous or too broad, ask via `AskUserQuestion`:
   > "What aspect of <topic> are you most interested in?"
   > Options: "How it works end-to-end", "Data flow / state", "Testing patterns", "Architecture decisions"
4. Determine if topic is a file path or a conceptual query
   - File path → skip to Phase 4 with that file
   - Conceptual → proceed to Phase 2

### Phase 2: Search

Run the codebase-search workflow (loaded via `skills: codebase-search`):

- `REPO_PATH` = repo from args or cwd (use the **main worktree** path, not a feature branch worktree, to avoid branch-specific bias)
- `QUERY` = the user's topic (from `$ARGUMENTS`), NOT the branch name or ticket
- `DOMAIN_TERMS` = extract key nouns from the user's topic

This produces a ranked file list with relevance tiers and key symbols.

**Validation:** Before proceeding, check that the search results actually relate to the user's topic. If results seem to be about the branch's feature instead, re-run search with more specific terms from the topic.

**DO NOT STOP HERE.** The search table is an intermediate result. Proceed to Phase 3.

### Phase 3: Narrow Scope

If search returns >5 High-relevance files, ask the user via `AskUserQuestion`:
> "I found N relevant files. Which area should I focus on?"
> Present top files grouped by domain (types, API, pages, features, etc.)

Select 3-5 files for deep analysis.

### Phase 4: Deep Dive

Invoke the deep-dive skill for thorough analysis:

```
Skill({ skill: "deep-dive", args: "<file1> <file2> <file3> --focus '<USERS TOPIC from $ARGUMENTS>' --include-tests" })
```

**IMPORTANT:** The `--focus` value must be the user's topic, not the branch name or ticket ID.

Note: `--include-quality` is **not** used here — learn is about understanding, not reviewing.

**DO NOT STOP HERE.** The deep-dive result is raw analysis. Proceed to Phase 5 to synthesize the explanation.

### Phase 5: Synthesize

Combine search results + deep-dive output into the explanation format from [EXPLANATION_TEMPLATE.md](EXPLANATION_TEMPLATE.md).

Key principles for the explanation:
- **Visual structure** — use tables, diagrams, and clear headings
- **Progressive disclosure** — overview first, then details
- **Concrete examples** — reference actual code paths and file locations
- **Data flow focus** — trace how data moves through the system
- **"Why" not just "what"** — explain design decisions where evident

### Phase 6: Offer Next Steps

End with 2-3 suggestions for further exploration:
- Related areas that connect to this topic
- Deeper dives into specific sub-modules
- Test files to read for behavioral understanding
- Git history to understand evolution

## Error Handling

| Scenario | Handling |
|----------|----------|
| No results found | Broaden search terms, ask user for clarification |
| Topic too broad | Ask user to narrow via AskUserQuestion |
| Repo not found | "Repo not found at <path>. Check the path or use --repo." |
| Deep dive fails | Present search results with kit_index_overview summaries |

## Output Contract

```
### Result
<Synthesised explanation of the topic/area>

### Context for Caller
- status: success|failed
- operation: learn
- topic: <topic>
- files_explored: <N>
- key_files: <comma-separated list>
```

## Token Budget

- codebase-search: ~2k tokens
- deep-dive (3 files, no quality): ~10k tokens
- Synthesis: ~2k tokens
- **Total: ~15k tokens**
