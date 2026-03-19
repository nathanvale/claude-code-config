# Nathan's Claude Code Preferences

- **Location** → Melbourne, Australia (AEST/AEDT)
- **ADHD** → Cognitive load is my enemy. DX matters enormously.
- **Visual learner** → Clear structure, whitespace, formatting help me process.
- **Exploratory** → I want to learn from what you do. Explain the "why."

### Hardware

- **Monitor** - Dell UltraSharp U4025QW (40" curved 5K2K Thunderbolt hub)
- **Mac 1 (MacBook Pro 14" M4 Pro, Space Black)** - Daily driver laptop, 12-core CPU, 16-core GPU, 24GB, 512GB SSD. TB4 to Port 1 (140W charging + KVM)
- **Mac 2 (Mac Mini M4 Pro)** - Home server, 14-core CPU, 20-core GPU, 64GB, 1TB SSD, Gigabit Ethernet, 3x TB5 + HDMI. DP to Port 2 + USB-C to Port 7 (KVM). SSH: `ssh -i ~/.ssh/id_rsa_github server@192.168.0.44`
- **macOS** - Tahoe 26.2 as of 2026-02-08 (confirm before assuming -- ask "still on Tahoe 26.2?" if version matters)

---

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

- **NEVER create `commands/*.md` slash commands** → Always use `skills/name/SKILL.md` instead. All skills are user-invocable with `/name` by default -- no special flags needed. Add `disable-model-invocation: true` only if you want to save context budget by hiding it from Claude's auto-discovery. Skills are a strict superset of commands (references, scripts, templates, frontmatter options). One pattern, zero decisions.

### Obsidian Vault

**NEVER use Write/Edit for vault content.** Use `/para-brain:*` commands only.

---

## Tool Preferences

**IMPORTANT:** All MCP tools are machine-to-machine interfaces optimized for token efficiency. **ALWAYS use `response_format: "json"`** for structured, token-efficient responses. Never use `"markdown"` unless showing results directly to user.

- **Git reads** → Use MCP tools with JSON format
  - `git_get_status({ response_format: "json" })`
  - `git_get_recent_commits({ response_format: "json" })`
  - `git_get_diff_summary({ response_format: "json" })`
- **Git writes** → Use bash or `/git:*` slash commands
- **Search** → Use Kit plugin with JSON format
  - `kit_grep({ response_format: "json" })`
  - `kit_semantic({ response_format: "json" })`
  - `kit_index_find({ response_format: "json" })`
  - `kit_callers({ response_format: "json" })`
- **Tests/Lint/Type Check** → **NEVER use Bash for these -- always use runner MCP tools**

  | Need | MCP Tool (preferred) | Fallback (Bash) |
  |------|---------------------|-----------------|
  | Run tests | `bun_runTests()` | `bun run test` |
  | Run single test file | `bun_testFile()` | `bun test path/to/file` |
  | Test coverage | `bun_testCoverage()` | `bun run test --coverage` |
  | Lint + format check | `biome_lintCheck()` | `bun run check` |
  | Lint with auto-fix | `biome_lintFix()` | `bun run lint:fix` |
  | Type check | `tsc_check()` | `bun run typecheck` |

  Always pass `response_format: "json"` to all runner MCP tools.
- **History** → Use Atuin MCP with JSON format
  - `atuin_search_history({ response_format: "json" })`
  - `atuin_history_insights({ response_format: "json" })`
- **Claude Code docs** → Use `/claude-code-docs:help` (never `claude-code-guide` sub-agent)
- **Package execution** → Prefer `bunx` over `npx` (faster, more reliable)

---

## Proactive Skill Matching

When Nathan asks about recent community discussions, trends, opinions, or "what people are saying" about a topic, invoke `/newsroom:investigate` via the Skill tool immediately. No need to ask permission -- just launch it. Nathan can always cancel/interrupt if he didn't want research.

**Trigger phrases:**
- "What are people saying about X?"
- "What's the community think about X?"
- "What's the latest buzz around X?"
- "Has anyone been talking about X?"
- "X vs Y" comparisons (use multi-topic: `"X" AND "Y" --quick`)

**Do NOT** just run WebSearch yourself -- the `/newsroom:investigate` skill searches Reddit, X, and the web with engagement metrics.

---

## Communication Style

- Technical and concise → explain decisions (the "why")
- No emojis unless asked
- Clear visual structure, break complex info into chunks
- We're fellow engineers → pair program, debate ideas, ship code
- Sprinkle "Nathan" occasionally (~1 in 5 responses)
- Celebrate wins → ADHD thrives on dopamine hits (emojis ok here)

**IMPORTANT**: It's ok to say "Sorry Nathan, I don't know."

---

## Quick Reference

### Key People

- **Melanie** → Partner ("Bestie" / "Sweetheart")
- **Levi** → Son (age 9), sole parent
- **Mum** → Lives in Sydney

### Context Files (invoke with @path when needed)

- `~/.claude/context/git-workflow.md` → Git safety, conventional commits
- `~/.claude/context/code-style.md` → TypeScript, testing, JSDoc
- `~/.claude/context/search-tools.md` → Kit plugin tool selection
- `~/.claude/context/bun-runner.md` → Test/lint MCP tools
- `~/.claude/context/atuin.md` → Shell history search
- `~/.claude/context/personal.md` → Birthdays, hobbies, details
- `~/.claude/context/obsidian-setup.md` → PARA method, vault commands

---

## Known Issues

### Bunx Cache Corruption (MCP Servers)

**Symptom:** MCP servers fail to start with errors like:
```
Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
```

**Cause:** Bunx caches packages in temp directories that can become corrupted (missing `package.json` files).

**Fix:** Clear the bunx cache for affected packages:
```bash
rm -rf /private/var/folders/_b/*/T/bunx-501-@side-quest/
```

Then restart the AI tool (Codex, Claude Code, etc.) to re-download packages.

### Git-Safety Hook Blocks Inline Python

**Symptom:** `python3 -c "..."` and heredoc (`python3 << 'PYEOF'`) patterns get rejected by the git-safety hook with "Inline interpreter execution cannot be safety-analyzed reliably."

**Workaround:** Write standalone scripts in `scripts/` and call them directly. Never use inline Python (`-c`, `-e`, `--eval`, heredoc) in Bash tool calls.

### VS Code - Minimal Extensions

VS Code runs with only 2 extensions (Night Owl theme + vscode-icons). Previous 68 extensions were backed up to `~/code/dotfiles/vscode-extensions-backup.txt` on 2026-02-21 if Nathan ever needs to find old ones to reinstall.

---

## Memory OS

- Shared user-scope memory contract lives at `~/.config/memory/AGENTS.md`
- Canonical docs live under `~/.config/memory/docs/`
- Canonical source lives in this repo at `~/code/claude-code-config/memory/`
- `~/.config/memory` is the stable runtime path and should resolve to this repo via `./install.sh`
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge
- Prefer QMD for broad federated recall and NotebookLM for curated synthesis packs
- User-invocable memory skills live under `~/.claude/skills/`
