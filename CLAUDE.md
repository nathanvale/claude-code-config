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
- **NEVER use em dashes (—)** → Use regular dashes (-) or double hyphens (--) instead

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
- **Tests/Lint/Type Check** → Use runner MCPs with JSON format
  - `bun_runTests({ response_format: "json" })`
  - `bun_lintCheck({ response_format: "json" })`
  - `bun_lintFix({ response_format: "json" })`
  - `tsc_check({ response_format: "json" })`
  - `biome_lintCheck({ response_format: "json" })`
  - `biome_lintFix({ response_format: "json" })`
- **History** → Use Atuin MCP with JSON format
  - `atuin_search_history({ response_format: "json" })`
  - `atuin_history_insights({ response_format: "json" })`
- **Claude Code docs** → Use `/claude-code-docs:help` (never `claude-code-guide` sub-agent)
- **Package execution** → Prefer `bunx` over `npx` (faster, more reliable)

---

## Proactive Skill Matching

When Nathan asks about recent community discussions, trends, opinions, or "what people are saying" about a topic, invoke `/research:last-30-days` via the Skill tool immediately. No need to ask permission -- just launch it. Nathan can always cancel/interrupt if he didn't want research.

**Trigger phrases:**
- "What are people saying about X?"
- "What's the community think about X?"
- "What's the latest buzz around X?"
- "Has anyone been talking about X?"
- "X vs Y" comparisons (use multi-topic: `"X" AND "Y" --quick`)

**Do NOT** just run WebSearch yourself -- the `/research:last-30-days` skill searches Reddit, X, and the web with engagement metrics.

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

### GMS Team (Bunnings)

**Team:** POS Yellow | **Comms:** Microsoft Teams | **Jira:** `POS-*`

**Repos**
- `Bunnings-Technology-Delivery/gms.app` → Frontend (React)
- `Bunnings-Technology-Delivery/gms.api` → Backend API (internal repo)
- `Bunnings-Technology-Delivery/voucher` → Voucher API

**Teams Channels**
- **POS Yellow and Payments Resellers** → PR reviews, announcements, technical discussions
- **POS Yellow Chat** → Daily updates (WFH/WFO, appointments, casual)
- **Resellers POD - Daily Standup** → Standup meeting chat

| Name | Role | Email |
|------|------|-------|
| Suzy Hall | Product Owner (PO) | Suzy.Hall@bunnings.com.au |
| Jackie Leslie | Delivery Manager (DM) | JLeslie@bunnings.com.au |
| Joshua Green | Tech Lead | JGreen@bunnings.com.au |
| Nathan Vale | Expert Frontend Engineer (you) | nathan.vale1@bunnings.com.au |
| June Xu | Developer (pairing partner) | JXu3@bunnings.com.au |
| Mustafa Jalil (MJ) | API/Backend Engineer | MJalil@bunnings.com.au |
| Prasanth Vannalath | API/Backend Engineer | PVannalath@bunnings.com.au |
| Marc Marais | Platform Engineer/Architect | MMarais@bunnings.com.au |
| Tanya Hopmans | Senior BA | Tanya.Hopmans@bunnings.com.au |
| Sonny Hartley | BA | sonny.hartley@bunnings.com.au |
| Cheryl Sim | Senior QA (POS expert) | CSim@bunnings.com.au |
| Angela Tuason | QA Tester | angela.tuason@bunnings.com.au |
| Aarti Gagneja | QA/Tester | AGagneja@bunnings.com.au |

### Context Files (invoke with @path when needed)

- `~/.claude/context/git-workflow.md` → Git safety, conventional commits
- `~/.claude/context/code-style.md` → TypeScript, testing, JSDoc
- `~/.claude/context/search-tools.md` → Kit plugin tool selection
- `~/.claude/context/bun-runner.md` → Test/lint MCP tools
- `~/.claude/context/atuin.md` → Shell history search
- `~/.claude/context/personal.md` → Birthdays, hobbies, details
- `~/.claude/context/obsidian-setup.md` → PARA method, vault commands

### Bunnings Proxy Toggle

When working with Bunnings repos, proxy settings can interfere with external tools like `gh`:

```bash
proxy-on      # Enable proxy (for VPN)
proxy-off     # Disable proxy (off VPN)
proxy-status  # Check current state
```

If `gh pr create` fails with "error connecting to vzen01.internal.bunnings.com.au", run `proxy-off` first.

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

### VS Code - Minimal Extensions

VS Code runs with only 2 extensions (Night Owl theme + vscode-icons). Previous 68 extensions were backed up to `~/code/dotfiles/vscode-extensions-backup.txt` on 2026-02-21 if Nathan ever needs to find old ones to reinstall.
