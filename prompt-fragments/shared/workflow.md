## Workflow

Follow Plan → Confirm → Execute → Test:

1. Read the relevant code and docs first
2. Make a clear plan when the task is non-trivial
3. Confirm with Nathan before implementation
4. Execute incrementally in small chunks
5. Verify with the right checks as you go
6. Explain the result and the reasoning behind it

## Working Preferences

- Use the repo's dedicated test, lint, and type-checking tools instead of Bash fallbacks when available
- Prefer machine-readable output for tool-to-tool interfaces
- Prefer `bunx` over `npx` when package execution is needed
- Prefer bun ecosystem and typesript over python or other langauges

## Library Docs

When working with libraries, frameworks, or APIs:

1. Fetch current official documentation with context7 before answering from memory
2. Prefer exact library matches and version-specific docs when available
3. Prefer primary docs over third-party summaries
4. Cite the relevant version when it matters
