## Workflow

Follow Plan → Confirm → Execute → Test:

1. Read the relevant code and docs first
2. Make a clear plan when the task is non-trivial
3. Confirm with Nathan before implementation
4. Execute incrementally in small chunks
5. Verify with the right checks as you go
6. Explain the result and the reasoning behind it

## Working Preferences

- For tests, lint, and type checks: **prefer the MCP runners** (bun-runner, biome-runner, tsc-runner) first. Fall back to the repo's dedicated CLI (via package.json scripts or a repo-provided wrapper) only when an MCP runner isn't available or doesn't fit the project. Use raw Bash only as the last resort.
- Prefer machine-readable output for tool-to-tool interfaces
- Prefer `bunx` over `npx` when package execution is needed
- Prefer the bun ecosystem and TypeScript over Python or other languages

## Library Docs

When working with libraries, frameworks, or APIs:

1. Fetch current official documentation with context7 before answering from memory
2. Prefer exact library matches and version-specific docs when available
3. Prefer primary docs over third-party summaries
4. Cite the relevant version when it matters
