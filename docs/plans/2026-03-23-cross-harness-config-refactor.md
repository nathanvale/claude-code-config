---
title: "Cross-Harness Config Surface Refactor"
type: plan
status: active
updated: 2026-03-23
summary: "Refactor plan for clarifying and syncing prompt instructions, Claude rules, Codex approval policy, skills, and sub-agent surfaces across Claude Code and Codex."
related:
  - docs/specs/prompt-system.md
  - docs/research/2026-03-23-agent-prompt-best-practices.md
  - docs/research/2026-03-23-multi-agent-config-sync.md
  - docs/plans/prompt-system-operator-skills-and-agents.md
source_system: chat
source: 2026-03-23 Codex/Claude prompt-system planning conversation
---

# Goal

Refactor the user-scope config system so Claude Code and Codex are modeled as related but distinct runtimes with different config surfaces, while keeping one clear source-of-truth workflow inside this repo.

# Why This Plan Exists

The current prompt system is already strong, but the naming and docs still blur several different surfaces:

- shared instruction prompts
- Claude-only behavioral rules
- Codex approval policy
- skills
- sub-agents
- Codex runtime config

Recent Codex updates make this distinction more important, not less.

# Confirmed Codex Surface Model

As of 2026-03-23, Codex should be modeled as a layered system:

1. Global instruction layer: `~/.codex/AGENTS.md`
2. Project instruction layer: repo-root `AGENTS.md`
3. Nested instruction layer: subdirectory `AGENTS.md` or `AGENTS.override.md`
4. Runtime config layer: `~/.codex/config.toml`
5. Approval-policy layer: `~/.codex/rules/`

Important Codex constraints and capabilities to account for:

- `AGENTS.md` is layered, not single-file only
- project doc size is byte-limited, not just line-limited
- fallback filenames are configurable
- runtime behavior is influenced by `config.toml`
- sub-agents inherit sandbox and network rules

# Desired Surface Model

Use this terminology everywhere in docs, skills, scripts, and generated agent surfaces:

## 1. Shared Instruction Surface

Purpose:
- behavior and policy both harnesses should follow

Repo source:
- `prompt-fragments/shared/`

Outputs:
- `AGENTS.md`
- `CLAUDE.md` via `@AGENTS.md`
- `generated/codex-user-agents.md`

## 2. Claude Behavioral Rule Surface

Purpose:
- Claude-only auto-applied behavioral prompts

Repo source:
- `rules/`
- `prompt-fragments/claude/`

Runtime:
- `~/.claude/rules/*.md`

## 3. Codex Instruction Surface

Purpose:
- Codex-specific runtime notes and instruction-layer behavior

Repo source:
- `prompt-fragments/codex/`

Runtime:
- `~/.codex/AGENTS.md`
- repo `AGENTS.md`
- nested `AGENTS.md` and `AGENTS.override.md`

## 4. Codex Approval-Policy Surface

Purpose:
- command approval, sandbox, and execution policy

Repo source:
- new managed surface to add in this refactor

Runtime:
- `~/.codex/rules/`

## 5. Skill Surface

Purpose:
- reusable workflows and domain playbooks

Repo source:
- new managed skill surface to add in this refactor

Runtime:
- `~/.claude/skills/`
- repo `.agents/skills/`
- user `$HOME/.agents/skills/`

## 6. Sub-Agent Surface

Purpose:
- thin named worker personas and specialist agents

Current repo source:
- `agents/`

Status:
- Claude-managed today
- Codex custom agent surfaces are now confirmed in repo `.codex/agents/` and user `~/.codex/agents/`

## 7. Codex Runtime Config Surface

Purpose:
- model, sandbox, approval, MCP, fallback filenames, byte limits, network, and filesystem behavior

Repo source:
- new managed config surface to add in this refactor

Runtime:
- `~/.codex/config.toml`

# Design Principles

- Keep prompts, skills, agents, approval policy, and runtime config as separate surfaces with distinct jobs.
- Do not pretend Claude behavioral rules and Codex approval rules are the same thing.
- Keep the shared instruction layer lean and non-inferable.
- Use repo-managed generated artifacts instead of ambient home-directory drift.
- Enforce contract distinctions with checks, not memory.
- Prefer byte-budget checks for Codex compatibility and line-budget checks for human readability.

# Refactor Scope

## Phase 1: Terminology And Docs Cleanup

Update repo docs so they consistently distinguish:

- shared instructions
- Claude behavioral rules
- Codex instruction layers
- Codex approval rules
- skills
- sub-agents
- Codex runtime config

Target files:

- `docs/specs/prompt-system.md`
- `docs/research/2026-03-23-agent-prompt-best-practices.md`
- `docs/research/2026-03-23-multi-agent-config-sync.md`
- `docs/reviews/2026-03-23-prompt-system-review.md`
- `docs/plans/prompt-system-operator-skills-and-agents.md`

## Phase 2: Prompt-System Contract Update

Extend the prompt-system spec so it explicitly models:

- Codex layered `AGENTS.md`
- Codex byte-budget constraints
- Codex `config.toml`
- Codex approval-policy rules as a separate surface
- sub-agent inheritance of sandbox and network rules

Outcome:
- one spec that describes the actual system instead of the previous simplified model

## Phase 3: Verification Hardening

Improve the current verification layer:

- add timeouts and structured failure states to `multi-agent-smoke`
- add byte-budget checks for Codex-facing outputs
- add checks for mirror coverage where Claude-only behavioral rules express shared intent
- add checks preventing shared prompts from describing Codex approval policy

Target files:

- `scripts/render-user-prompts.sh`
- `scripts/multi-agent-smoke.ts`
- `scripts/multi-agent-smoke-lib.ts`
- `scripts/multi-agent-smoke.test.ts`

## Phase 4: Codex Approval-Rule Management

Add a repo-managed source for Codex approval rules and a sync/check workflow.

Proposed new surface:

- `codex-rules/` or `codex-approval-rules/`

Proposed commands:

- `./scripts/sync-codex-rules.sh --write`
- `./scripts/sync-codex-rules.sh --check`
- `./scripts/sync-codex-rules.sh --diff`

Goal:
- manage Codex execution policy as code without mixing it into prompts

## Phase 5: Codex Runtime Config Management

Add a managed source for `~/.codex/config.toml`.

This should cover:

- fallback filenames
- project doc byte limits
- model defaults
- sandbox defaults
- approval defaults
- network and filesystem policy
- MCP-related settings that belong in runtime config

Goal:
- make Codex runtime behavior reproducible across machines

## Phase 6: Skill Syncing

Add a repo-managed skill surface and sync workflow.

Proposed structure:

- `managed-skills/shared/`
- `managed-skills/claude/`
- `managed-skills/codex/`

Rules:

- only explicitly shared skills sync to both harnesses
- shared skills must not assume harness-specific tools unless split into variants
- skill metadata should declare target harnesses

Proposed commands:

- `./scripts/sync-user-skills.sh --write`
- `./scripts/sync-user-skills.sh --check`
- `./scripts/sync-user-skills.sh --diff`

## Phase 7: Sub-Agent Sync Design

Design how repo-managed sub-agents should be split across:

- existing Claude-oriented `agents/`
- repo `.codex/agents/`
- user `~/.codex/agents/`

Questions to answer:

- which current repo agents are Claude-only versus portable in intent
- whether shared agent intent should live once with harness-specific adapters or in separate source trees
- which sub-agent definitions need runtime config assumptions documented alongside them

Codex sub-agents inherit sandbox and network policy from the parent runtime when those fields are not overridden. That reduces the need for a separate sub-agent policy sync model.

## Phase 8: Claude Agent Surface Cleanup

Clean up and document the existing `agents/` surface.

Goals:

- distinguish agent definitions from skills
- distinguish sub-agents from prompt fragments
- explain which agents are repo-owned and which are home-directory runtime concerns
- wire agent-related docs into the main control-plane story

## Phase 9: Skill And Router Updates

Update all prompt-system skills and related agents so they route changes by surface.

Key updates:

- `prompt-system-router`
- `prompt-system-workflow`
- `prompt-contract-auditor`
- `prompt-smoke-runner`

Each should distinguish:

- shared instruction
- Claude rule
- Codex instruction
- Codex approval rule
- skill
- sub-agent
- runtime config
- on-demand reference

## Phase 10: Generated Surface Refresh

After source docs and scripts are corrected, refresh generated user-facing artifacts:

- `AGENTS.md`
- `CLAUDE.md`
- `generated/codex-user-agents.md`

Keep Codex-facing wording short:

- AGENTS are instruction layers
- Codex rules are approval policy
- runtime config lives in `config.toml`

# Recommended Order

1. Terminology and docs
2. Prompt-system spec update
3. Verification hardening
4. Codex approval-rule management
5. Codex runtime config management
6. Skill syncing
7. Sub-agent investigation
8. Claude agent surface cleanup
9. Skill/router updates
10. Generated surface refresh

# Verification

Minimum verification for the refactor:

- `./scripts/render-user-prompts.sh --check`
- byte-budget validation for Codex outputs
- structured smoke runs with timeout handling
- drift checks for skill sync
- drift checks for Codex approval-rule sync
- drift checks for Codex `config.toml` sync

Where sub-agent support is changed or clarified, add targeted verification for inheritance of sandbox and network constraints.

# Open Questions

1. Should repo-managed Codex approval rules be symlinked or copied into `~/.codex/rules/`?
2. Should repo-managed Codex config be rendered from fragments or maintained as one canonical template?
3. Should shared skills be stored once with metadata or duplicated into harness-specific variants for clarity?
4. Should portable agent intent be stored once and adapted per harness, or duplicated into explicit Claude/Codex agent source trees for clarity?

# Non-Goals

- replacing the existing fragment render system with `rulesync`
- collapsing Claude rules and Codex approval rules into one abstraction
- auto-promoting every repeated correction into startup prompts
- assuming cross-harness parity where the runtimes do not actually share the same surface model

# Success Criteria

This refactor is successful when:

- docs describe the real Claude/Codex surface model accurately
- routing skills can place changes correctly on the first pass
- Codex runtime behavior is reproducible from repo-managed config
- shared skills can be synced intentionally instead of ambiently
- sub-agent support is either verified and supported or explicitly scoped out
- verification scripts fail fast when the surface boundaries drift
