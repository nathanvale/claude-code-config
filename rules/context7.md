---
alwaysApply: true
---

When working with libraries, frameworks, or APIs, use Context7 to fetch current documentation instead of relying on training data.

## MCP

1. Call `resolve-library-id` with the library name and question.
2. Pick the best match. Prefer exact names and version-specific IDs when a version is mentioned.
3. Call `query-docs` with the selected library ID and question.
4. Answer from fetched docs. Include code examples and cite the version when available.

## CLI Fallback

Use this path when Context7 MCP tools are absent or auth is blocked.

1. Run `npx -y ctx7 library <name> "<question>"`.
2. Pick the best library ID.
3. Run `npx -y ctx7 docs <libraryId> "<question>"`.
4. Answer from fetched docs. Name the library ID used.
