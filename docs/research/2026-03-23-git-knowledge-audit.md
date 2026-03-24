---
title: "Git Knowledge Audit — What We Know and Where It Lives"
type: research
status: complete
created: 2026-03-23
summary: "Comprehensive audit of all git-related documentation, research, brainstorms, plans, hooks, and rules across Nathan's repos. Maps the knowledge graph and identifies what fed into the current claude-code-config git system."
tags: [git, audit, knowledge-graph, hooks, safety, conventional-commits, worktrees, federation]
---

# Git Knowledge Audit — What We Know and Where It Lives

## Purpose

Nathan suspected he had git research scattered across repos. This audit searched QMD (30 collections, ~63k documents) and grepped across all repos in `~/code` to find every git-related document: research, brainstorms, plans, specs, hooks, rules, and reference docs.

**Finding:** There is a rich, well-structured body of git knowledge — 4 research docs, 5 brainstorms, 7+ plans, 3 implementation specs, and production hooks — but it's split across 6 repos with no cross-reference index until now.

---

## The Knowledge Graph

### Layer 1: Community Research (side-quest-marketplace)

The foundation layer. Community intelligence gathered via beat reporters across Reddit, X, and web.

| Doc | Date | What it covers | Key findings |
|-----|------|---------------|--------------|
| [git-plugin-landscape.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/research/2026-02-11-git-plugin-landscape.md) | 2026-02-11 | Full landscape — AI commit tools, safety guardrails, worktrees, PR review. 166 X posts, 150 web pages. | 10+ fragmented commit tools, dcg as leading safety tool, Midjourney mandating AI commits, `--no-verify` abuse by Claude Code |
| [git-plugin-landscape-update.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/research/2026-03-02-git-plugin-landscape-update.md) | 2026-03-02 | March delta — CVEs, new tools, standards matured | CVE-2025-59536 wake-up call, safety-net (semantic analysis), Git AI v3.0.0, Claude Code native worktrees, session managers emerged |
| [safety-hook-architecture.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/research/2026-03-02-safety-hook-architecture.md) | 2026-03-02 | Deep dive — PreToolUse deny pattern as industry standard | 6 major implementations cataloged (Trail of Bits, dcg, safety-net, Blake Crosley, Lasso Security, Anthropic sandbox). Architectural principles extracted. |
| [arena-merge-vs-squash-agentic-coding.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/research/2026-03-05-arena-merge-vs-squash-agentic-coding.md) | 2026-03-05 | Adversarial arena — merge vs squash in agentic coding | Merge 19/25 vs Squash 18/25. Hybrid answer: preserve history on branches, squash to main. $60M Entire bet on per-commit observability. 55% review slowdown with unpruned history. |

### Layer 2: Brainstorms (side-quest-marketplace)

Evaluation and design exploration, built on the research layer.

| Doc | Topic | Status | Key decisions |
|-----|-------|--------|---------------|
| [git-plugin-v2-marketplace-port.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/brainstorms/2026-03-02-git-plugin-v2-marketplace-port.md) | Porting V1 git plugin to marketplace architecture | Complete | Keep shared modules (event-bus-client, git-status-parser), keep worktree CLI dependency |
| [git-plugin-v2-feature-evaluation.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/brainstorms/2026-03-02-git-plugin-v2-feature-evaluation.md) | Feature-by-feature uplift decisions | Complete | ADOPT: `/commit-push-pr`, `/clean-gone`. DEFER: Git AI v3.0.0 provenance. ADOPT: dual-audience commits, anti-slop guardrails, SSW narrative strategy |
| [git-plugin-v2-advanced-safety.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/brainstorms/2026-03-02-git-plugin-v2-advanced-safety.md) | Shell tokenization for safety hooks | Draft | Option A (build our own) vs Option B (recommend safety-net as companion). Our hook does regex; safety-net does proper tokenization 10 levels deep. |
| [git-plugin-v2-git-intelligence-migration.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/brainstorms/2026-03-02-git-plugin-v2-git-intelligence-migration.md) | MCP to skill migration for git reads | Draft | Old MCP had 20-30% token overhead. 7 read-only tools being retired. Core value was auto-invoke behavior from tool palette presence. |
| [git-plugin-v2-worktree-strategy.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/brainstorms/2026-03-02-git-plugin-v2-worktree-strategy.md) | Worktree session management direction | Draft | Our CLI vs Claude Code native `--worktree` (v2.1.49). Session managers (ccmanager, muxtree, agtx) emerged as category. |

### Layer 3: Implementation Plans (side-quest-marketplace)

Phased execution plans derived from the brainstorms.

| Doc | Phase | Status |
|-----|-------|--------|
| [git-plugin-v2-marketplace-port-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-marketplace-port-plan.md) | Master plan — 5 phases | Draft |
| [git-plugin-v2-phase-1-port-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-phase-1-port-plan.md) | Port to marketplace | Draft |
| [git-plugin-v2-phase-2-compliance-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-phase-2-compliance-plan.md) | Marketplace compliance (descriptions, hooks, self-destruct) | Deepened |
| [git-plugin-v2-phase-3-safety-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-phase-3-safety-plan.md) | Safety fixes (stash drop, reset --merge, find -delete) | Draft |
| [git-plugin-v2-phase-4-commands-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-phase-4-commands-plan.md) | New commands (commit-push-pr, clean-gone) | Deepened |
| [git-plugin-v2-phase-5-references-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-02-feat-git-plugin-v2-phase-5-references-plan.md) | Reference updates (anti-slop, dual-audience, safety-net) | Deepened |
| [dx-git-split-workflow-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-05-feat-dx-git-split-workflow-plan.md) | Split workflow — splitting WIP branches into multiple PRs | Active |

### Layer 4: Production Implementation (claude-code-config)

What actually shipped and runs today. This is what the research and planning layers fed into.

#### Docs (`docs/git/`)

| File | What it is |
|------|-----------|
| [conventions.md](file:///Users/nathanvale/code/claude-code-config/docs/git/conventions.md) | Conventional commits reference — types, scopes, subject rules, anti-slop guardrails, AI attribution |
| [workflows.md](file:///Users/nathanvale/code/claude-code-config/docs/git/workflows.md) | Step-by-step procedures: commit, squash, checkpoint, PR, session log, review PR, changelog, compare, commit-push-PR, clean-gone |
| [worktree.md](file:///Users/nathanvale/code/claude-code-config/docs/git/worktree.md) | Git worktree management via `@side-quest/git` CLI |

#### Hooks (`hooks/git/`)

| File | What it does |
|------|-------------|
| `git-safety.ts` | PreToolUse hook — blocks destructive commands (force push, hard reset, rm -rf, etc.) |
| `git-policy.ts` | Exports `PROTECTED_BRANCHES` (env-configurable, defaults to main/master) |
| `git-utils.ts` | Shared utilities (getCurrentBranch, etc.) |
| `git-status-parser.ts` | Parses git status output |
| `git-context-loader.ts` | Loads git context for SessionStart |

#### Prompt Fragments & Rules

| File | Scope | What it does |
|------|-------|-------------|
| `prompt-fragments/shared/git-policy.md` | Claude + Codex | Safety rules, branch policy, procedure pointers |
| `rules/git-workflow.md` | Claude only | Attribution, HEREDOC format, workflow dispatch routing |

### Layer 5: Cross-Repo Git Docs

Other repos with git-related documentation.

| Repo | File | What it covers |
|------|------|---------------|
| **side-quest-runners** | [hook-dedup-spec-and-claude-hooks-layout-plan.md](file:///Users/nathanvale/code/side-quest-runners/docs/plans/2026-03-07-feat-hook-dedup-spec-and-claude-hooks-layout-plan.md) | Hook dedup via `tool_use_id`, flattened package layout, stdout safety boundary, single `sq-claude-hook` binary |
| **side-quest-marketplace-old** | [GIT_WORKFLOW.md](file:///Users/nathanvale/code/side-quest-marketplace-old/docs/GIT_WORKFLOW.md) | Original git workflow — conventional commits, `/git:commit`, `/git:create-pr`, `/git:checkpoint` |
| **experience-sdk** | [BRANCHING.md](file:///Users/nathanvale/code/experience-sdk/docs/BRANCHING.md) | Monash branching strategy — develop/main, Jira key branch names, squash-and-merge, commitlint |
| **imessage-timeline** | [branch-protection-policy.md](file:///Users/nathanvale/code/imessage-timeline/website/docs/branch-protection-policy.md) | Branch protection settings — required checks, commitlint, PR title lint, CodeQL, dependency review |
| **imessage-timeline** | [automated-release-workflow.md](file:///Users/nathanvale/code/imessage-timeline/docs/guides/automated-release-workflow.md) | Changesets + conventional commits + Husky + npm provenance — full release pipeline |
| **imessage-timeline** | [ci-workflow-standards.md](file:///Users/nathanvale/code/imessage-timeline/docs/guides/ci-workflow-standards.md) | Composite actions, least-privilege permissions, concurrency groups |
| **side-quest-marketplace** | [dx-plugin-hook-guards-plan.md](file:///Users/nathanvale/code/side-quest-marketplace/docs/plans/2026-03-04-fix-dx-plugin-hook-guards-plan.md) | Missing prerequisite guards in dx-plugin hooks |

### Layer 6: Related Context

Docs that touch git tangentially.

| Repo | File | Relevance |
|------|------|-----------|
| **vault** | thariq-applied-analysis.md | Notes hook infrastructure (git-safety, ADHD coach) and proposes PreToolUse skill usage tracking |
| **claude-code-config** | [adhd-coach-hooks.md](file:///Users/nathanvale/code/claude-code-config/docs/brainstorms/adhd-coach-hooks.md) | Parked ADHD hook system — dangerous command blocking duplicated git-safety.ts |
| **side-quest-marketplace** | naming-conventions-claude-code-plugins.md | Hook file naming should match lifecycle event (mirrors Git's `pre-commit` convention) |

---

## Lineage Map

How research flowed into implementation:

```
RESEARCH (Feb-Mar 2026)
├── git-plugin-landscape (Feb 11) ─────────────┐
├── git-plugin-landscape-update (Mar 2) ───────┤
├── safety-hook-architecture (Mar 2) ──────────┤
└── arena-merge-vs-squash (Mar 5) ─────────┐   │
                                           │   │
BRAINSTORMS (Mar 2)                        │   │
├── marketplace-port ◄─────────────────────┼───┘
├── feature-evaluation ◄───────────────────┤
│   ├── advanced-safety ◄──────────────────┤
│   ├── git-intelligence-migration         │
│   └── worktree-strategy                  │
│                                          │
PLANS (Mar 2-5)                            │
├── Phase 1: Port ◄── marketplace-port     │
├── Phase 2: Compliance                    │
├── Phase 3: Safety ◄── advanced-safety    │
├── Phase 4: Commands ◄── feature-eval     │
├── Phase 5: References                    │
└── dx-git:split ◄────────────────────────┘

PRODUCTION (claude-code-config)
├── docs/git/conventions.md ◄── Phase 5 anti-slop
├── docs/git/workflows.md ◄── Phase 4 commit-push-pr, clean-gone
├── docs/git/worktree.md ◄── worktree-strategy
├── hooks/git/git-safety.ts ◄── Phase 3 + safety-hook-architecture
├── hooks/git/git-policy.ts ◄── feature-evaluation branch policy
├── prompt-fragments/shared/git-policy.md ◄── shared safety rules
└── rules/git-workflow.md ◄── Claude-specific dispatch
```

---

## What's Implemented vs Still in Plans

| Feature | Research | Brainstorm | Plan | Implemented |
|---------|----------|------------|------|-------------|
| Conventional commits | Yes | Yes | Phase 5 | Yes — conventions.md, anti-slop guardrails |
| Safety hooks (regex) | Yes | Yes | Phase 3 | Yes — git-safety.ts |
| Shell tokenization (deep) | Yes | Yes (Option A/B) | Phase 3 | **No** — still regex-based, safety-net recommended |
| Branch protection | Yes | Yes | Phase 1 | Yes — git-policy.ts, PROTECTED_BRANCHES |
| Commit-push-PR workflow | Yes | Yes | Phase 4 | Yes — workflows.md Commit-Push-PR section |
| Clean-gone workflow | Yes | Yes | Phase 4 | Yes — workflows.md Clean-Gone section |
| Worktree management | Yes | Yes | Separate | Yes — worktree.md + @side-quest/git CLI |
| Git AI v3.0.0 provenance | Yes | DEFER | - | **No** — deferred as premature |
| MCP to skill migration | - | Yes | - | **Partial** — MCP retired, context loader remains |
| dx-git:split workflow | Yes | - | Active | **No** — plan exists, not implemented |
| Hook dedup | - | - | Yes (runners) | **No** — plan in side-quest-runners |
| Release automation (Changesets) | - | - | - | Yes — in imessage-timeline only |
| Branch protection (GitHub) | - | - | - | Yes — in imessage-timeline only |

---

## Repos Where This Knowledge Lives

| Repo | Role | Doc count |
|------|------|-----------|
| **side-quest-marketplace** | Research + brainstorms + plans (the "lab") | 16 git docs |
| **claude-code-config** | Production implementation (the "deployment") | 8 git files |
| **side-quest-runners** | Hook architecture plans | 1 git doc |
| **side-quest-marketplace-old** | Original V1 workflow (superseded) | 1 git doc |
| **imessage-timeline** | Release automation reference implementation | 3 git docs |
| **experience-sdk** | Monash branching strategy (work context) | 1 git doc |
| **everything-claude-code** | Community git workflow rules (reference corpus) | 4 git docs (translations) |

---

## Observations

1. **The research-to-implementation pipeline worked well.** Community intel (Feb 11) → landscape update (Mar 2) → brainstorms (same day) → phased plans → shipped code in claude-code-config. Clean lineage.

2. **Shell tokenization is the biggest open gap.** The safety hook uses regex. The research identified this as HIGH risk. The brainstorm documented Option A (build) vs Option B (recommend safety-net). Neither has been implemented. The current `git-safety.ts` does have a `shell-tokenizer.ts` module, suggesting Option A was partially pursued.

3. **dx-git:split is the most advanced unshipped plan.** Deeply researched (born from the arena debate), deeply planned (10 research agents), but not yet built.

4. **imessage-timeline has the most complete CI/CD git setup** of any repo — Changesets, Husky, commitlint, branch protection, composite actions, npm provenance. Could be a template.

5. **The V2 plugin plans in side-quest-marketplace are frozen.** 5 phases planned, none marked complete. The production code in claude-code-config appears to have cherry-picked the best ideas (commit-push-pr, clean-gone, anti-slop) without following the formal phase plan.

6. **QMD now finds all of this.** Before this session, QMD searches for "conventional commits" or "safety hooks" returned zero relevant results because side-quest-marketplace's docs weren't properly masked, and 18 repos were missing entirely.
