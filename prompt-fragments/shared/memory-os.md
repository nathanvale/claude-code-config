## Memory OS

- Shared user-scope memory contract lives at `~/.config/memory/AGENTS.md`
- Canonical docs live under `~/.config/memory/docs/`
- Canonical source lives in this repo at `~/code/claude-code-config/memory/`
- `~/.config/memory` is the stable runtime path and should resolve to this repo via `./install.sh`
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge
- Prefer QMD for broad federated recall and NotebookLM for curated synthesis packs

### Context Files (invoke with @path when needed)

- `~/.claude/context/git-workflow.md` → Git safety, conventional commits
- `~/.claude/context/code-style.md` → TypeScript, testing, JSDoc
- `~/.claude/context/search-tools.md` → Kit plugin tool selection
- `~/.claude/context/bun-runner.md` → Test/lint MCP tools
- `~/.claude/context/atuin.md` → Shell history search
- `~/.claude/context/personal.md` → Birthdays, hobbies, details
- `~/.claude/context/obsidian-setup.md` → PARA method, vault commands
