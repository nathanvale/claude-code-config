---
title: "Agent Prompt Best Practices — Community Research"
type: research
status: active
updated: 2026-03-23
method: "Beat reporter research across Reddit, X, YouTube, and web sources + QMD recall of prior research"
summary: "Comprehensive community research on how power users structure top-level prompts (CLAUDE.md, AGENTS.md, .cursorrules) to drive AI coding agents. Synthesizes new findings with prior research from 2026-03-11 (markdown-knowledge-for-agents) and 2026-03-23 (multi-agent-config-sync)."
related:
  - docs/reviews/2026-03-23-prompt-system-review.md
  - docs/specs/prompt-system.md
  - docs/decisions/2026-03-22-non-inferable-filter-for-sizing.md
prior_research:
  - repo: monash-smst
    path: docs/research/2026-03-11-markdown-knowledge-for-agents.md
    overlap: "~60% — token limits, progressive disclosure, four-section structure, AGENTS.md standard, lean vs distributed debate"
  - repo: claude-code-config
    path: docs/research/2026-03-23-multi-agent-config-sync.md
    overlap: "~40% — rulesync, AGENTS.md convergence, ETH Zurich paper, symlinks vs render pipelines"
sources:
  - r/ClaudeAI
  - r/ClaudeCode
  - r/LLMDevs
  - r/cursor
  - r/PromptEngineering
  - x.com
  - youtube.com
  - code.claude.com
  - cursor.com
  - arxiv.org
  - dev.to
  - humanlayer.dev
  - builder.io
  - particula.tech
  - dbreunig.com
  - trigger.dev
  - github.com/trailofbits
  - github.com/lifedever/claude-rules
  - github.com/dyoshikawa/rulesync
---

# Agent Prompt Best Practices — Community Research

## Summary

This document synthesizes community intelligence on how power users structure top-level prompts to drive AI coding agents. It combines three research waves:

1. **2026-03-11** — Markdown Knowledge for Agents (monash-smst repo)
2. **2026-03-23** — Multi-Agent Config Sync (this repo)
3. **2026-03-23** — This investigation: three-beat research across Reddit, X, and web

The core finding: the community has converged on **modular, scoped, reactive rule systems** over monolithic prompt files. The debate has shifted from "what to put in CLAUDE.md" to "how to architect a prompt system."

---

## Part 1: Established Consensus (Prior Research, Confirmed)

These findings were established in prior research and remain current with strong ongoing community validation.

### Token Budget Is Real

- Frontier LLMs reliably follow ~150-200 total instructions
- Claude Code's built-in system prompt consumes ~50, leaving 100-150 for user content
- Files over 300-500 lines start degrading instruction compliance
- Anthropic's own docs: "If Claude keeps doing something you don't want despite a rule, the file is probably too long and the rule is getting lost"

### Progressive Disclosure via @imports

- Keep root CLAUDE.md under 60-300 lines
- Push detailed guidance into domain-specific files loaded on demand
- Recursive @imports up to 5 levels deep
- Skills load only when the agent deems the task relevant — metadata decides activation, not content

### Four-Section Root Structure

Community consensus on what belongs in the root file:

```
1. Project context     — one line, what is this thing
2. Code style prefs    — specific, not generic ("ES modules, named exports, 2-space indent")
3. Commands            — exact verbatim strings with flags
4. Architecture decisions — patterns that would be violated without this file
```

### AGENTS.md as Cross-Tool Standard

- Originated by OpenAI (August 2025), adopted by Linux Foundation's Agentic AI Foundation
- 60,000+ open-source repos
- Supported natively by: Codex CLI, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Amp, Devin, Aider, Zed, Warp, RooCode
- Claude Code uses CLAUDE.md natively; AGENTS.md is fallback
- The "90% rule": most content overlaps across formats; only 10% is tool-specific
- Migration path: `mv CLAUDE.md AGENTS.md && ln -s AGENTS.md CLAUDE.md`

### Modular > Monolith

Every source agrees. Both camps in the "lean vs distributed" debate agree on one thing: a massive monolithic file stuffed with everything is the worst pattern. The disagreement is about how distributed to go.

### ETH Zurich: Less Is More

Paper: "Evaluating AGENTS.md" (arxiv.org/html/2602.11988v1):
- LLM-generated context files reduce success rates ~3% while increasing inference costs 20%+
- Human-written files: only 4% gain
- Recommendation: keep to non-inferable details only
- A concurrent paper found AGENTS.md reduced runtime 28% and output tokens 16% — different metrics, both true

### Subdirectory Loading Footgun

CLAUDE.md files in subdirectories only load when the agent reads a file in that directory via the Read tool — not from directory presence. Workaround: root CLAUDE.md should explicitly link to subdirectory files with descriptions so the agent can proactively fetch them.

---

## Part 2: New Findings (This Investigation)

These findings are net-new from the March 23 three-beat investigation.

### The L0-L6 Maturity Model

Source: dev.to/cleverhoods — practitioner-developed six-level framework:

| Level | Name | Description |
|-------|------|-------------|
| L0 | Absent | No instruction file |
| L1 | Basic | File exists, version-controlled |
| L2 | Scoped | RFC 2119 language (MUST/MUST NOT) |
| L3 | Structured | Multiple files, router with @imports |
| L4 | Abstracted | Path-scoped rules via `.claude/rules/` |
| L5 | Maintained | L4 + staleness tracking, regular reviews |
| L6 | Adaptive | Dynamic capability loading via Skills + MCP |

Our setup scores L5-L6: fragment system with render script, drift detection, skills, MCP servers.

The academic study (arxiv.org/html/2602.14690) confirms most teams never get past L1/L2. Shallow adoption of advanced features is the norm.

### Self-Updating CLAUDE.md Pattern

Source: @yanndine (X, 1,683 likes) + multiple independent builders

The agent writes its own rules after each correction. Pattern:
- User corrects agent behavior
- Agent appends learned rule to CLAUDE.md
- Future sessions inherit the correction

This is the "reactive rule addition" philosophy taken to its logical extreme. Multiple independent builders converged on this pattern without coordination.

### Empirical Benchmark: 1,188 Runs on Compression

Source: r/ClaudeAI (122 pts, 14 comments)

Key findings:
- Stripping markdown formatting reduces file size 60-70%
- CLAUDE.md "raises the floor, not the ceiling" — prevents bad outputs more than it enables great ones
- **Procedural checklists produce more consistent output than generic style instructions**
- Workflows and checklists outperform generic style rules

### Trail of Bits Reference Implementation

Source: @dguido (X, 1,121 likes), github.com/trailofbits/claude-code-config

The most detailed public CLAUDE.md template found. Structure:
- Hard constraints (no speculative features, replace-don't-deprecate)
- Language-specific toolchains (uv/ruff for Python, oxlint/vitest for Node, clippy for Rust)
- Explicit testing order
- Commit and PR standards
- Hooks as decision-point guardrails, not just security boundaries
- Custom statusline showing token usage, cost, and cache hit rate
- Aggressive credential deny rules blocking ~/.ssh, ~/.aws, wallet data

### Cursor .mdc Scoped Rule Types

Source: trigger.dev/blog/cursor-rules, cursor.com/blog/agent-best-practices

Cursor deprecated `.cursorrules` for `.cursor/rules/*.mdc` (YAML frontmatter + Markdown body). Four rule types:

| Type | Behavior |
|------|----------|
| Always | Injected into every prompt regardless of context |
| Auto Attached | Fires for matched file glob patterns (monorepos) |
| Agent Requested | Intent-based — agent decides when to load |
| Manual | Explicit attachment only |

Anti-pattern: "Always" rules that are too broad waste context. "Agent Requested" with good descriptions is the progressive disclosure equivalent for Cursor.

### The Composable Rules Pattern

Source: github.com/lifedever/claude-rules

Three-tier layered approach:

```
Base (Required):     core.md, git.md
Languages (Select):  typescript.md, python.md, go.md, rust.md
Frameworks (Select): react.md, vue.md, spring-boot.md
```

Priority: Framework > Language > Base.

Key technique: **quantified metrics and Bad/Good code comparisons** instead of prose. Example:
- "Functions ≤30 lines"
- "Files ≤300 lines"
- "Nesting ≤3 levels"

### The Three-Tier Boundary System

Source: particula.tech — most-cited structural pattern for rules:

```
Always Do:   Run tests, add types, follow conventions
Ask First:   Schema changes, new dependencies, auth flows
Never Do:    Commit secrets, skip tests, force push main
```

Exact commands beat vague descriptions. Instead of "we use pnpm," write:
```
pnpm test --coverage --watchAll=false
```

GitHub's analysis of 2,500+ repos: "One real code snippet beats three paragraphs of style description."

### System Prompt Swap Experiment

Source: dbreunig.com (Feb 10, 2026)

Compared six CLI coding agents: Claude Code, Cursor, Gemini CLI, Codex CLI, OpenHands, Kimi CLI. When system prompts were swapped across agents on the same model, behavior diverged immediately:
- Codex prompt → "methodical, documentation-first" output
- Claude prompt → "iterative: try something, see what breaks, fix it"

Key quote: "The system prompt determines whether the model's theoretical ceiling is reached."

### Boris Cherny's Method (Claude Code Creator)

Source: @milesdeutscher (X, 3,203 likes) summarizing Boris Cherny's approach

Structure: past errors, conventions, rules. The creator of Claude Code uses a single CLAUDE.md file — but a carefully curated one focused on non-inferable details.

### Unicode Prompt Injection in Shared Rules

Source: r/cursor PSA (Mar 2026)

6 out of 50 shared .cursorrules files from GitHub contained hidden Unicode characters (U+E0001-E007F range) for prompt injection. **Always audit shared config files before importing.**

### Rules vs Skills: Complementary, Not Competing

Source: dev.to/nedcodes — tested both

- Rules with `alwaysApply: true` inject into every prompt regardless of relevance
- Skills only load when the agent deems the task relevant
- Rules for predictable enforcement (style, conventions)
- Skills for dynamic procedural workflows
- Anti-pattern: catch-all skills that are "huge" and load for everything — atomic, single-purpose skills outperform broad ones

### Agent Engineering 101 Mental Model

Source: adithyan.io

Clear framing of the stack:
- **AGENTS.md** = trail markers (progressive wayfinding)
- **Skills** = loaded capabilities (Matrix kung fu upload)
- **MCP** = live connectivity (ranger station)

Recommendation: start simple, observe failure patterns, then layer in structure — not over-engineer upfront.

---

## Part 3: Anti-Patterns (Cross-Source Consensus)

Repeated across every source, prior and new:

| Anti-Pattern | Why It Fails |
|-------------|--------------|
| The bloated file | Rules get lost in noise; agent starts ignoring them |
| Prose over examples | Three paragraphs of style description loses to one code snippet |
| No verification criteria | Without tests/checks, there's no self-correction loop |
| Static-only rules | Never using path-scoping or progressive loading means rules fight for context budget |
| Tool-specific duplication | Maintaining parallel .cursorrules and CLAUDE.md with copied content |
| Outdated rules | No maintenance discipline means stale rules cause agent confusion |
| LLM-generated context files | ETH Zurich: reduces success rates ~3%, increases cost 20%+ |
| Catch-all skills | Broad skills that load for everything waste context budget |
| Monolithic file stuffed with everything | Both lean and distributed camps agree this is the worst pattern |

---

## Part 4: Contrarian and Dissenting Views

| View | Source | Engagement |
|------|--------|------------|
| "None of us know what we're doing, everyone is guessing" | Top comment on r/ClaudeAI CLAUDE.md-as-OS post | 192 pts |
| "Delete your CLAUDE.md/AGENTS.md file" | @theo (X) | 7,630 likes |
| "Don't put structure in CLAUDE.md — discovery is part of the process" | u/StunningChildhood837 | Contrarian minority |
| "Don't use CLAUDE.md for CLI forcing — use hooks instead" | Matt Pocock (YT) | 29K views |
| "If your agent relies on a 3,000-word System Prompt, you've built a house of cards" | @techNmak | Moderate engagement |
| "I would always prefer a small rule set over a larger more comprehensive one" | @nicolaygerold | Direct counter to "stuff everything in" |
| Heavily layered agent.md files "make problem-solving slightly worse while increasing token usage" | r/ClaudeCode dissenting view | Part of 27-file debate |

The @theo post (7,630 likes) catalyzed the ETH Zurich discussion and remains the strongest contrarian signal. The paper partly validates his instinct — LLM-generated context files are net-negative.

---

## Part 5: How Our Setup Compares

| Community Pattern | Our Setup | Assessment |
|-------------------|-----------|------------|
| Modular fragments over monolith | 13 fragments across 3 tiers | Ahead of community |
| Drift detection / render checks | `render-user-prompts.sh --check` + hygiene checks | Rare — almost nobody does this |
| Thin root, deep skills | CLAUDE.md @imports AGENTS.md (128 lines rendered) | Aligned |
| Reactive rule addition | NEVER rules are specific and earned | Aligned |
| AGENTS.md as cross-tool standard | Shared + codex layers via render pipeline | Ahead |
| Token budget discipline | Context files lazy-loaded via @path | Aligned |
| Three-tier boundaries (Always/Ask/Never) | `boundaries.md` has all three tiers | Shipped |
| Non-inferable filter | ADR exists, shared fragments cleaned of branded paths | Shipped (first pass) |
| Contract invariants + routing guide | Spec documents 7 invariants and routing test | Shipped |
| Shared-fragment hygiene checks | Render script validates no harness leakage | Shipped |
| 13 rules covering safety, workflow, boundaries, quality | Full rule set from debugging to security | Shipped |
| Self-updating rules | Not present | Gap — community pattern worth evaluating |
| Quantified metrics in rules | Not present | Minor gap |
| Bad/Good code comparisons | Not present | Minor gap |
| Staleness tracking (L5) | Review-note contract exists, no cadence trigger | Partial |
| Hooks as guardrails | Present in settings.json | Aligned |
| Security audit of imported rules | Not formalized | Minor gap |

### Maturity Assessment: L6

Our setup sits at the top of the maturity model. Remaining gaps:
1. Self-updating rules (agent learns from corrections)
2. Quantified metrics where applicable
3. Formal staleness review cadence (trigger, not just contract)

---

## Part 6: Actionable Recommendations

### Keep Doing

- Fragment architecture with automated render pipeline
- Shared/claude/codex tier split with drift detection
- Lazy-loaded context files
- Concrete NEVER rules over vague guidance
- Personal context (ADHD, visual learner) — this is genuinely useful signal

### Shipped Since Initial Research

1. **"Ask First" boundary tier** — `boundaries.md` now has Always Do / Ask First / Never Do
2. **13 rules** covering debugging, scope, deps, security, testing, self-check + original 7
3. **Contract invariants** — 7 invariants + routing guide in prompt-system spec
4. **Shared-fragment hygiene checks** — render script fails on harness-branded paths
5. **Interface-neutral shared layer** — branded paths and stale runtime nouns removed from shared/
6. **Review-note contract** — evaluative docs now have a defined format

### Also Shipped (Same Session)

7. **Bad/Good code comparisons** — added to testing-policy, debugging-workflow, scope-discipline, security-boundaries
8. **Quarterly review cadence** — added to prompt-system spec with 5-step checklist
9. **Trail of Bits + lifedever/claude-rules** — added as reference implementations in prompt-system spec

### Consider Adding

1. **Quantified code metrics** in repo-level CLAUDE.md files where applicable (e.g., "functions ≤30 lines") — better suited per-repo than user-scope

### Evaluate (Not Urgent)

1. **Self-updating pattern** — the agent appending learned rules after corrections. Promising but adds maintenance risk if not governed
2. **Bad/Good code comparison format** — showing anti-pattern alongside correct pattern in rules
3. **rulesync adoption** — if the number of target agents grows beyond Claude + Codex

### Validated by This Research

1. **The audit's refactor direction** (shared = intent, specific = interface) matches community consensus exactly
2. **The non-inferable filter ADR** is supported by ETH Zurich's findings
3. **The render pipeline approach** is more sophisticated than anything else in the wild — the community standard is symlinks

---

## Source Links

### Academic

- [Configuring Agentic AI Coding Tools: An Exploratory Study](https://arxiv.org/html/2602.14690) — arxiv.org
- [Evaluating AGENTS.md](https://arxiv.org/html/2602.11988v1) — arxiv.org (ETH Zurich)

### Official Documentation

- [Best Practices for Claude Code](https://code.claude.com/docs/en/best-practices) — Anthropic
- [Cursor Agent Best Practices](https://cursor.com/blog/agent-best-practices) — Cursor
- [Equipping Agents with Agent Skills](https://claude.com/blog/equipping-agents-for-the-real-world-with-agent-skills) — Anthropic

### Blog Posts and Guides

- [CLAUDE.md Best Practices: From Basic to Adaptive (L0-L6)](https://dev.to/cleverhoods/claudemd-best-practices-from-basic-to-adaptive-9lm) — dev.to
- [How to Write Great Cursor Rules](https://trigger.dev/blog/cursor-rules) — trigger.dev
- [AGENTS.md: The File That Makes AI Coding Agents Useful](https://particula.tech/blog/agents-md-ai-coding-agent-configuration) — particula.tech
- [Writing a Good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md) — humanlayer.dev
- [How to Write a Good CLAUDE.md File](https://www.builder.io/blog/claude-md-guide) — builder.io
- [System Prompts Define the Agent as Much as the Model](https://www.dbreunig.com/2026/02/10/system-prompts-define-the-agent-as-much-as-the-model.html) — dbreunig.com
- [Agent Engineering 101: A Visual Guide](https://www.adithyan.io/blog/agent-engineering-101) — adithyan.io
- [Cursor Rules vs Agent Skills: I Tested Both](https://dev.to/nedcodes/cursor-rules-vs-agent-skills-i-tested-both-heres-when-each-one-actually-works-1ld) — dev.to
- [CLAUDE.md, AGENTS.md, and Every AI Config File Explained](https://www.deployhq.com/blog/ai-coding-config-files-guide) — deployhq.com

### GitHub Repos

- [Trail of Bits claude-code-config](https://github.com/trailofbits/claude-code-config) — enterprise-grade reference
- [lifedever/claude-rules](https://github.com/lifedever/claude-rules) — composable cross-tool rules
- [dyoshikawa/rulesync](https://github.com/dyoshikawa/rulesync) — multi-tool config sync CLI (921 stars)
- [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — curated list
- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) — curated .cursorrules examples
- [Notes on AI Agent Rule/Instruction/Context Files](https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6) — comprehensive inventory

### Reddit (by engagement)

- [I Haven't Written a Line of Code in Six Months](https://www.reddit.com/r/ClaudeAI/comments/1rlw1yw/) — 2,012 pts, 551 comments
- [What happens when you stop adding rules to CLAUDE.md](https://www.reddit.com/r/ClaudeAI/comments/1rz2oo3/) — 524 pts, 152 comments
- [Prompt Engineering is Dead in 2026](https://www.reddit.com/r/PromptEngineering/comments/1rci46t/) — 354 pts, 120 comments
- [I built a CLAUDE.md that solves the compaction/context loss problem](https://www.reddit.com/r/ClaudeAI/comments/1r06z4r/) — 247 pts, 61 comments
- [How I structure Claude Code projects](https://www.reddit.com/r/ClaudeAI/comments/1r66oo0/) — 215 pts, 33 comments
- [CLAUDE.md as operating system](https://www.reddit.com/r/ClaudeAI/comments/1qvmjic/) — 214 pts, 109 comments
- [AGENTS.MD standard](https://www.reddit.com/r/ClaudeCode/comments/1rlc8zi/) — 128 pts, 81 comments
- [1,188 benchmark runs on CLAUDE.md compression](https://www.reddit.com/r/ClaudeAI/comments/1ridyke/) — 122 pts, 14 comments
- [Subdirectory loading footgun](https://www.reddit.com/r/LLMDevs/comments/1rwh2yd/) — 73 pts, 24 comments

### X / Twitter (by engagement)

- [@rubenhassid — Anatomy of a Claude 4.6 Prompt](https://x.com/rubenhassid/status/2027991271252320693) — 8,178 likes
- [@theo — Delete your CLAUDE.md](https://x.com/theo/status/2025900730847232409) — 7,630 likes
- [@godofprompt — Karpathy rant as system prompt](https://x.com/godofprompt/status/2018482335130296381) — 6,315 likes
- [@milesdeutscher — Boris Cherny's method](https://x.com/milesdeutscher/status/2034658673738580442) — 3,203 likes
- [@mntruell — Cursor CEO tips](https://x.com/mntruell/status/2013636888242835810) — 3,027 likes
- [@yanndine — Self-updating CLAUDE.md](https://x.com/yanndine/status/2026382902406123654) — 1,683 likes
- [@RoundtableSpace — Claude Code creator uses single file](https://x.com/RoundtableSpace/status/2034929187841352077) — 1,581 likes
- [@omarsar0 — Codified Context paper](https://x.com/omarsar0/status/2027770787659464812) — 1,486 likes
- [@dguido — Trail of Bits defaults](https://x.com/dguido/status/2021837449979105648) — 1,121 likes
- [@garrytan — Codex as review skill](https://x.com/garrytan/status/2034545005797450145) — 1,055 likes

### YouTube (by views)

- [Claude Code Full Course 4 Hours — Nick Saraev](https://www.youtube.com/watch?v=QoQBzR1NIqI) — 822K views
- [How I use Claude Code — John Kim (Meta Staff Engineer)](https://www.youtube.com/watch?v=mZzhfPle9QU) — 301K views
- [My top 6 tips for Claude Code — Academind](https://www.youtube.com/watch?v=WwdIYp5fuxY) — 126K views
- [Create Your First SKILL.md File — Code A Program](https://www.youtube.com/watch?v=Fh-aBKrG5CI) — 71K views
- [Don't use CLAUDE.md for CLI forcing — Matt Pocock](https://www.youtube.com/watch?v=3CSi8QAoN-s) — 29K views
