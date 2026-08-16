# Search Tools

Repo-owned research-tool contract for agents.

## Contract

- Prefer `rg` first for repository text search.
- Query Context7 for current library, framework, SDK, API, CLI, and cloud-service docs.
- Start Firecrawl for web research, current public pages, docs outside Context7, and search-result discovery.
- Reach for Kit tools only when available and useful for semantic, symbol, AST, or file-tree repository lookup.
- Fall back to built-in web search only when Firecrawl is unavailable or the requested source type is outside Firecrawl.
- Never put secrets, token values, key prefixes, cookies, or auth-bearing URLs into docs, prompts, logs, or feedback.

## Context7

- Resolve a library before querying docs unless the user gives a Context7 library ID.
- Query docs with the narrow task, version, framework, or API surface.
- Use `npx -y ctx7 library <name> "<query>"` when the MCP tool is absent.
- Use `npx -y ctx7 docs <id> "<query>"` after resolving the ID through the CLI fallback.
- Record a Context7 MCP auth gap when the CLI fallback works but native MCP tools are absent.

## Firecrawl

- Start open-web research with `firecrawl_search`.
- Process the useful results.
- Call `firecrawl_search_feedback` after using or rejecting search results.
- Use `firecrawl_map` to find the right page inside a known site.
- Use `firecrawl_scrape` for known URLs and full-page or structured extraction.
- Use `firecrawl_agent` only after search/map/scrape cannot reach the target.
- If `firecrawl_search` is hidden, run `tool_search("firecrawl_search", limit: 30)`.

## MCP Auth

- Check `codex mcp list` for configured server shape.
- Check `codex doctor` for missing env vars or broken MCP config.
- Check wrapper, keychain, and `op` readiness instead of inspecting secret values.
- Use `$HOME/code/dotfiles/bin/with-one-password-token` or an approved keychain owner for key-bearing MCPs. Never create provider auth bins or use `with-env`.
- Never source `.env` or print key prefixes to prove auth.
- Restart or reload the agent session after MCP config changes; existing sessions can hold stale tool metadata.

## Proof

- Context7 proof: resolve a known library, then query docs.
- Firecrawl proof: run a one-result `firecrawl_search`, then send `firecrawl_search_feedback`.
- Config proof: run `codex mcp list` and confirm `context7` and `firecrawl` are enabled.
- Startup proof: run `scripts/agent-instructions.sh` after changing `AGENTS.md`.

## Kit Repository Lookup

- `kit_grep`: text patterns, regex, literal matches, TODOs.
- `kit_semantic`: natural-language repository search.
- `kit_symbols`: function, class, and variable definitions.
- `kit_usages`: call sites and references.
- `kit_ast_search`: structural patterns such as async functions, classes, and arrow functions.
- `kit_file_tree`: repository structure overview.
- `kit_file_content`: multi-file content retrieval.
