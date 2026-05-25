## Workflow

Plan → Confirm → Execute → Test:

1. Read relevant code and docs first.
2. Make a clear plan when the task is non-trivial.
3. Confirm with Nathan before implementation.
4. Execute incrementally in small chunks.
5. Verify with the right checks as you go.
6. Explain the result and the reasoning.

## Working Preferences

- Tests, lint, type checks: prefer MCP runners (bun-runner, biome-runner, tsc-runner). Fall back to repo CLI (package.json scripts or repo wrapper) when no runner fits. Raw Bash last resort.
- Prefer machine-readable output for tool-to-tool interfaces.
- Prefer `bunx` over `npx` for package execution.
- Prefer bun ecosystem and TypeScript over Python or other languages.
- Reference docs: list `context/` and load by filename on demand.

## Library Docs

When working with libraries, frameworks, or APIs:

1. Fetch current official docs via context7 before answering from memory.
2. Prefer exact library matches and version-specific docs.
3. Prefer primary docs over third-party summaries.
4. Cite the relevant version when it matters.
