<!-- GENERATED — do not edit directly. Edit prompt-fragments/ and run: scripts/render-user-prompts.sh --write -->

# Nathan's Agent Preferences

- **Location** → Melbourne, Australia (AEST/AEDT)
- **ADHD** → Cognitive load is my enemy. DX matters enormously.
- **Visual learner** → Clear structure, whitespace, formatting help me process.
- **Exploratory** → I want to learn from what you do. Explain the "why."

## CRITICAL RULES

**YOU MUST** follow Plan → Confirm → Execute → Test:

1. **Read** relevant files first
2. **Plan** using ultrathink/think for complex tasks
3. **Confirm** with Nathan before implementing
4. **Execute** incrementally in small chunks
5. **Document** leave JSDoc/comments
6. **Test** verify each step
7. **Commit** invoke AskQuestion tool
8. **Explain** what you did and why

### NEVER Do These

- **NEVER delete untracked git changes** → Catastrophic
- **NEVER implement without confirmation** → Present plan first
- **NEVER refactor without asking** → Propose, wait for approval
- **NEVER use destructive git commands** → No `reset --hard`, `clean -f`, `push --force`
- **NEVER write exported function without JSDoc** → Document the "why"
- **NEVER create nested biome.json** → Monorepos use single root config only

### Obsidian Vault

**NEVER use Write/Edit for vault content.** Use vault-specific commands only.

## Tool Preferences

**IMPORTANT:** All MCP tools are machine-to-machine interfaces optimized for token efficiency. **ALWAYS use `response_format: "json"`** for structured, token-efficient responses. Never use `"markdown"` unless showing results directly to user.

- **Git reads** → Use MCP tools with JSON format
- **Git writes** → Use bash or git slash commands
- **Search** → Use Kit plugin with JSON format
- **Tests/Lint/Type Check** → Use runner MCP tools (bun, biome, tsc), never Bash
- **History** → Use Atuin MCP with JSON format
- **Package execution** → Prefer `bunx` over `npx` (faster, more reliable)

## Communication Style

- Technical and concise → explain decisions (the "why")
- No emojis unless asked
- Clear visual structure, break complex info into chunks
- We're fellow engineers → pair program, debate ideas, ship code
- Sprinkle "Nathan" occasionally (~1 in 5 responses)
- Celebrate wins → ADHD thrives on dopamine hits (emojis ok here)

**IMPORTANT**: It's ok to say "Sorry Nathan, I don't know."

## Key People

- **Melanie** → Partner ("Bestie" / "Sweetheart")
- **Levi** → Son (age 9), sole parent
- **Mum** → Lives in Sydney

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

