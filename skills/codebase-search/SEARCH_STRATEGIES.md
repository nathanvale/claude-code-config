# Search Strategies

Tech-stack-specific patterns for finding relevant code. Use `response_format: "json"` on ALL MCP calls.

## Tool Loading

All Kit and Git MCP tools are deferred. Load them via `select:` for exact matching — keyword search (`+kit ...`) can miss tools when many Kit tools compete for the top 5 slots.

```
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_file_tree" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_index_prime" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_semantic" })
ToolSearch({ query: "select:mcp__plugin_kit_kit__kit_index_overview" })
ToolSearch({ query: "select:mcp__plugin_git_git-intelligence__git_search_commits" })
```

Run all 5 in parallel. Built-in tools (`Grep`, `Glob`, `Read`) need no loading.

## React / TypeScript Key Areas

| Domain | Location | What to look for |
|--------|----------|------------------|
| Types | `src/types/` | Interfaces, enums, type unions |
| API layer | `src/api/` | RTK Query endpoints, hooks |
| Pages | `src/pages/` | Route components, page state |
| Features | `src/features/` | Domain hooks, utils |
| Redux | `src/reducers/` | Slices, selectors, actions |
| Components | `src/components/` | Shared UI components |
| MSW mocks | `src/msw/` | Handlers, mock data |
| Tests | Adjacent `.test.tsx` files | Test coverage for key files |

## Token-Efficient Exploration Order

Always follow this order — cheapest first, expensive last:

1. **Index prime** — build searchable index (one-time ~100 tokens)
2. **Grep** — literal keyword search, most reliable for domain terms (~200 tokens/term)
3. **Semantic search** — find files by meaning, good for conceptual queries (~500 tokens)
4. **Git history** — understand recent changes (~300 tokens/query)
5. **Index overview** — see symbols without reading source (~100 tokens/file)
6. **File tree** — understand structure, scope to subdirectory (~500 tokens, skip if known)
7. **Read** — only for critical files (expensive, ~1k+ tokens/file)
8. **Callers/blast** — only for key functions (~200 tokens)

## Search Strategy Selection

| Query Type | Primary Strategy | Secondary | Example |
|------------|-----------------|-----------|---------|
| Domain term | **Grep** | Git history | "seller", "fulfilment" |
| Conceptual | **Semantic** | Grep on extracted nouns | "how does auth work" |
| Ticket-based | **Git history** | Grep on entity names | "POS-3044" |
| File-specific | **Glob** | Index overview | "SellerFilterHelpers" |

## Kit Index Limitations

`kit_index_overview` does **not** index:
- TypeScript `interface` declarations
- TypeScript `type` aliases
- `const` arrow function exports (e.g., `export const foo = () => {}`)
- Re-exports (`export { X } from './Y'`)

When `symbolCount: 0`, run an **export grep** fallback to recover the file's public API:

```
Grep({ pattern: "^export", path: "<absolute file path>", output_mode: "content", "-n": true })
```

This reveals exported interfaces, types, functions, and constants — enough to populate the Key Symbols column and make informed deep-dive decisions. ~100 tokens per file, run in parallel for all 0-symbol files.

## Impact Analysis Tools

When the caller needs to understand blast radius (not part of standard search):

```
kit_callers({ path: REPO_PATH, function_name: "<key function>", response_format: "json" })
kit_blast({ path: REPO_PATH, target: "<key file or symbol>", response_format: "json" })
kit_usages({ path: REPO_PATH, symbol: "<exported symbol>", response_format: "json" })
```

## C# / .NET Repos

For backend repos (gms.api, voucher), delegate to the `api-discovery` skill which has architecture docs and search patterns specific to those codebases.

See [api-discovery/SKILL.md](../api-discovery/SKILL.md).
