## Compound Codex Tool Mapping (Claude Compatibility)

Tool mapping:

- Read: `rg`, `sed`, `cat`, or repo-aware retrieval when appropriate.
- Write: `apply_patch` for manual edits.
- Edit/MultiEdit: `apply_patch`.
- Shell: `exec_command`. For tests/lint/type-check, prefer MCP runners (`bun_runTests`, `biome_lintCheck`, `tsc_check`) over `bun test`, `biome`, `tsc` through `exec_command`.
- Grep: `rg` (fallback: `grep`).
- Glob: `rg --files` or `find`.
- LS: `ls` via `exec_command`.
- Web/docs research: Context7 for library docs; web tools only when needed.
- AskUserQuestion/Question: ask the user in chat.
- Parallel reads/checks: `multi_tool_use.parallel` when tasks are independent.
- TodoWrite/TodoRead: file-based todos in `todos/` with file-todos skill.
- Skill: open the referenced SKILL.md and follow it.
- ExitPlanMode: ignore.
