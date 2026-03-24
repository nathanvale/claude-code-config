---
name: codebase-search
description: Find relevant files in a codebase by topic, ticket, or diff. Returns prioritized file list with key symbols. Not user-invocable — composed into workflow skills.
allowed-tools: mcp__plugin_kit_kit__*, mcp__plugin_git_git-intelligence__*, Bash(git:*), Read, Glob, Grep, ToolSearch
user-invocable: false
context: inline
---

# Codebase Search

Find and rank relevant files in a codebase for a given topic, ticket, or set of search terms. Returns a structured file table — the caller decides what to do next (deep-dive, read, etc.).

**This skill runs inline** (no fork) so the caller retains the file list in its own context.

## Pre-flight: Load MCP Tools

MCP tools are deferred and **must be loaded before use**. Use `select:` for exact tool loading — keyword search can miss tools when there are many matches.

Run these in parallel:

```
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_file_tree" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_index_prime" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_semantic" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_index_overview" })
ToolSearch({ query: "select:mcp__plugin_git_git-intelligence__git_search_commits" })
```

Do NOT call MCP tools before loading them. Built-in tools (`Grep`, `Glob`, `Read`) need no loading.

## Inputs

The caller provides:
- `REPO_PATH` — absolute path to the repository root
- `QUERY` — ticket summary, topic description, or key search terms
- `TICKET_ID` (optional) — Jira ticket ID for git history search
- `DOMAIN_TERMS` (optional) — additional domain-specific terms to search

Extract `DOMAIN_TERMS` from `QUERY` by pulling out key nouns (e.g., "seller filtering" → domain terms: `["seller", "filter"]`).

## Workflow

### Phase 1: Orient

**Index prime** is required before `kit_index_overview` or `kit_index_find` can work. File tree is optional — skip if the caller already knows the codebase structure, or scope to a specific subdirectory to avoid overflow on large repos.

```
kit_index_prime({ path: REPO_PATH, response_format: "json" })
```

Optionally (if codebase is unfamiliar):
```
kit_file_tree({ path: REPO_PATH, subpath: "<specific subdirectory>", response_format: "json" })
```

**File tree tip:** Never run `kit_file_tree` on the full `src/` of a large repo — it can return 80k+ chars. Scope to a relevant subdirectory (e.g., `src/pages/BulkPrintOrders`) or skip entirely if the caller already knows the layout.

### Phase 2: Search (parallel — all three strategies at once)

Run **all of these in parallel** to triangulate results from different angles:

**2a. Semantic search** — finds files by meaning:
```
kit_semantic({ path: REPO_PATH, query: QUERY, response_format: "json", top_k: 10 })
```

**2b. Literal grep** — finds files by exact keyword match (catches what semantic misses):
```
Grep({ pattern: "<primary domain term>", path: REPO_PATH + "/src", output_mode: "files_with_matches", glob: "*.{ts,tsx}", "-i": true })
```

Run one `Grep` per domain term if there are multiple (e.g., "seller" and "filter" separately). This is the **most reliable** search for domain-specific terms that semantic search may misinterpret.

**2c. Git history** — finds files by commit context:

If `TICKET_ID` provided:
```
git_search_commits({ path: REPO_PATH, query: TICKET_ID, response_format: "json" })
```

If `DOMAIN_TERMS` provided (run one per term, parallel):
```
git_search_commits({ path: REPO_PATH, query: "<term>", response_format: "json" })
```

**Why all three?** Semantic search works well for conceptual queries ("how does auth work") but poorly for domain-specific terms ("seller filtering") where it matches on related but wrong concepts. Grep is precise for known terms. Git history reveals files changed together in relevant features.

### Phase 3: Refine

1. **Merge & deduplicate** files from all Phase 2 results
2. **Rank by signal strength:**
   - File appears in 3 sources (semantic + grep + git) → very likely relevant
   - File appears in 2 sources → likely relevant
   - File appears in 1 source → check with overview
3. **Filter out noise:** Exclude test files, cypress files, and config files from primary results (list them separately as Medium relevance)
4. Take top 10 unique source files, run:

```
kit_index_overview({ path: REPO_PATH, file: "<file path>", response_format: "json" })
```

**0-symbol files:** When `kit_index_overview` returns `symbolCount: 0`, the file likely contains TypeScript interfaces, type exports, or `const` arrow functions that Kit's indexer doesn't pick up. Run an **export grep** to recover what the index missed:

```
Grep({ pattern: "^export", path: "<absolute file path>", output_mode: "content", "-n": true })
```

This is cheap (~100 tokens per file) and reveals the file's public API — exported interfaces, types, functions, and constants. Use these export names as the Key Symbols in the output table instead of "(types — not indexed)".

Run export greps **in parallel** for all 0-symbol files.

### Phase 4: Present

Output a ranked file table. Target <2k tokens.

```markdown
## Search Results: <QUERY>

| # | File | Relevance | Key Symbols | Notes |
|---|------|-----------|-------------|-------|
| 1 | `src/types/seller.ts` | High | `ISeller`, `ISellerPermissions`, `ISellerPrinting` | Core type definition |
| 2 | `src/api/bulkPrintApi.ts` | High | `useGetSellersQuery`, `useGetDesignsQuery` | RTK Query API layer |
| 3 | `src/pages/BulkPrintOrders/CreateBulkPrintOrderPage.tsx` | High | `CreateBulkPrintOrderPage`, `handleSubmit` (8 symbols) | Main page consuming seller config |
| ... | ... | ... | ... | ... |

### Recommended Deep-Dive Files
- `src/types/seller.ts` — 3 exported interfaces defining the seller domain model
- `src/pages/BulkPrintOrders/SellerFilterHelpers.ts` — 2 exported filter functions
- `src/pages/BulkPrintOrders/CreateBulkPrintOrderPage.tsx` — main consumer with 8 symbols
```

**Relevance tiers:**
- **High** — directly implements or consumes the queried feature/entity
- **Medium** — related utility, test, or adjacent module
- **Low** — tangential reference (omit from table, mention in notes if relevant)

### Search Signal Legend

Include this below the table so the caller understands confidence:

```markdown
### Search Signals
- `S` = semantic search | `G` = grep match | `H` = git history
- Files matching multiple signals are higher confidence
```

## Token Budget

- Index prime: ~100 tokens
- File tree (scoped): ~500 tokens (skip if not needed)
- Semantic search (10 results): ~500 tokens
- Grep (per term): ~200 tokens
- Git search (per query): ~300 tokens
- Index overview (per file): ~100 tokens
- Export grep (per 0-symbol file): ~100 tokens
- **Total budget: ~4k tokens input, <2k tokens output**

## Fallback Strategy

| Scenario | Fallback |
|----------|----------|
| Kit index unavailable | Rely on Grep + git history (skip index_overview) |
| Semantic search fails/returns noise | Grep results are the primary signal |
| Grep returns too many files (>20) | Narrow glob pattern to specific subdirectory |
| Git search returns nothing | Skip — not all work has prior commits |
| All searches return nothing | Report empty, suggest caller broadens terms or provides file paths directly |
| ToolSearch fails to load MCP tools | Fall back to Grep + Glob (built-in tools, always available). Report per [INBOX_PROTOCOL.md](../babysitter/INBOX_PROTOCOL.md): error `mcp_tool_load_failed` |
