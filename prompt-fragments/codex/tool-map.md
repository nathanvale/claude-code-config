## Compound Codex Tool Mapping (Claude Compatibility)

Tool mapping:
- Read: use `rg`, `sed`, `cat`, or repo-aware retrieval tools when appropriate
- Write: use `apply_patch` for manual edits
- Edit/MultiEdit: use apply_patch
- Shell: use `exec_command`
- Grep: use `rg` (fallback: `grep`)
- Glob: use `rg --files` or `find`
- LS: use `ls` via `exec_command`
- Web/docs research: use Context7 for library docs and web tools only when needed
- AskUserQuestion/Question: ask the user in chat
- Parallel reads/checks: use `multi_tool_use.parallel` when tasks are independent
- TodoWrite/TodoRead: use file-based todos in todos/ with file-todos skill
- Skill: open the referenced SKILL.md and follow it
- ExitPlanMode: ignore
