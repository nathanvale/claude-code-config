---
title: "Multi-Agent Config Sync Research"
type: research
status: active
updated: 2026-03-23
summary: "How developers manage shared configuration across Claude Code, Codex, Cursor, and other AI coding agents. Community patterns, tooling, and standards."
---

# Multi-Agent Config Sync Research

## Context

We need behavioral guidance visible to Codex through its instruction surfaces. Follow-up verification against the official Codex docs clarified that Codex now has multiple adjacent runtime surfaces:

- layered `AGENTS.md` discovery
- Starlark execution-policy rules in `~/.codex/rules/`
- runtime config in `.codex/config.toml` and `~/.codex/config.toml`
- skill discovery from `.agents/skills/` and `$HOME/.agents/skills`
- custom agents in `.codex/agents/` and `~/.codex/agents/`

Those surfaces are complementary, not interchangeable. Behavioral prompt content still belongs in `AGENTS.md`, not Codex `.rules`.

## Key Findings

### 1. rulesync — the main tooling solution (921 GitHub stars)

`github.com/dyoshikawa/rulesync` — a CLI that maintains a canonical `.rulesync/` directory and generates tool-specific config files for 25+ AI coding tools including Claude Code, Codex, Cursor, Cline, Gemini CLI, Windsurf, Kiro, and Goose. Covers rules, MCP config, commands, subagents, skills, and hooks. Install via npm or Homebrew. Listed in Awesome Claude Code and Awesome Gemini CLI.

### 2. AGENTS.md is the convergence standard

- Linux Foundation's Agentic AI Foundation (AAIF) has AGENTS.md as a founding project
- Platinum members: AWS, Anthropic, Google, Microsoft, OpenAI, Block, Bloomberg, Cloudflare
- Cursor deprecated `.cursorrules` in favor of AGENTS.md
- Codex reads AGENTS.md natively
- 60k+ open source projects adopted
- Claude Code uses CLAUDE.md natively; AGENTS.md is fallback

### 3. ETH Zurich: less is more

Paper: "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" (arxiv.org/html/2602.11988v1). LLM-generated context files reduce success rates ~3% while increasing inference costs 20%+. Human-written files: only 4% gain. Recommendation: keep to non-inferable details only (specific tooling, custom build commands, conventions). A concurrent paper found AGENTS.md reduced runtime 28% and output tokens 16% — different metrics, both true.

### 4. Community pattern: symlinks, not build scripts

The dominant approach: `mv CLAUDE.md AGENTS.md && ln -s AGENTS.md CLAUDE.md`. The `@AGENTS.md` import inside CLAUDE.md is the field-tested winner — Claude Code's preprocessor catches it before the model sees it. Our render pipeline is more sophisticated than anything else in the wild.

### 5. No cross-tool user-scope standard

Each vendor owns their home directory convention: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`. No shared standard for user-scope config. This is the gap our system fills.

### 6. Cross-agent audit pattern emerging

Garry Tan (YC CEO, 1,055 likes): "Codex is GOAT at finding bugs... I added a /codex skill that does plan and code review in Claude Code." Claude writes, Codex reviews is becoming a pattern.

### 7. Subdirectory loading is a known footgun

CLAUDE.md files in subdirectories only load when the agent reads a file in that directory via the Read tool — not on directory presence. Workaround: root CLAUDE.md should explicitly link to subdirectory files.

## Decision

**Extend existing render pipeline (Option A)** rather than adopt rulesync (Option B).

**Why:** Our fragment render system is already more mature than the symlink-only pattern most teams use. rulesync would replace our pipeline with less control over composition. The fix is not "copy Claude rules into Codex rules." The correct move is to keep behavioral guidance in Codex-visible `AGENTS.md` layers and treat Codex `.rules` as a separate execution-policy surface.

**How:** Continue rendering behavioral guidance into the Codex instruction layer, document Codex runtime surfaces explicitly, and manage approval-policy/config/skills/agents as adjacent surfaces rather than pretending they are all prompt fragments.

## Sources

### Reddit (high engagement)

- [What happens when you stop adding rules to CLAUDE.md](https://www.reddit.com/r/ClaudeAI/comments/1rz2oo3/) — 524 pts, 152 comments
- [AGENTS.MD standard](https://www.reddit.com/r/ClaudeCode/comments/1rlc8zi/) — 128 pts, 81 comments
- [Your CLAUDE.md files in subdirectories might not be doing what you think](https://www.reddit.com/r/LLMDevs/comments/1rwh2yd/) — 73 pts, 24 comments
- [Pointing CLAUDE.md to AGENTS.md](https://www.reddit.com/r/ClaudeCode/comments/1r9zx34/) — 38 pts, 65 comments

### X (high engagement)

- [@theo](https://x.com/theo/status/2025900730847232409) — "Delete your CLAUDE.md/AGENTS.md file" — 7,630 likes, catalyst for ETH Zurich discussion
- [@omarsar0](https://x.com/omarsar0/status/2027770787659464812) — Codified Context paper — 1,486 likes
- [@garrytan](https://x.com/garrytan/status/2034545005797450145) — Codex as review skill — 1,055 likes
- [@rauchg](https://x.com/rauchg/status/2035076089861857500) — Next.js 16.2 is agent-native with AGENTS.md — 967 likes
- [@tibor_tee](https://x.com/tibor_tee/status/2033500405100101745) — Cursor team confirming AGENTS.md convergence

### Web

- [rulesync](https://github.com/dyoshikawa/rulesync) — 921 stars, CLI for multi-tool config generation
- [AGENTS.md official site](https://agents.md/) — Linux Foundation backed standard
- [ETH Zurich paper](https://arxiv.org/html/2602.11988v1) — AGENTS.md effectiveness evaluation
- [deployhq config guide](https://www.deployhq.com/blog/ai-coding-config-files-guide) — comprehensive file format mapping
- [0xdevalias gist](https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6) — inventory of every agent rule file format
