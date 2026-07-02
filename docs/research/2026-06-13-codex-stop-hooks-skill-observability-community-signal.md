---
title: Codex Stop hooks and skill observability community signal
date: "2026-06-13"
type: research
status: evidence
owner: skills/skill-feedback
source_window: "2026-05-13 to 2026-06-12"
---

# Codex Stop hooks and skill observability community signal

Use this research as evidence for the skill-feedback v2 pivot. It is not an accepted decision. Promote only accepted terminology, gates, or implementation commitments into `skills/skill-feedback/CONTEXT.md`, `docs/decisions/`, or ADRs.

## Bottom line

- Community signal supports the pivot from "trusted Codex skill identity first" to "evidence-tiered review value first."
- People are using Codex hooks as deterministic runtime gates and using agent observability tools for OTel-backed run/tool/session telemetry.
- The exact missing primitive is first-class skill-use observability: a canonical engine-owned event that says which skill was invoked, when, and why.
- Current public signal does not show a mature Stop-hook-based pattern for proving trusted skill identity.
- Treat Codex Stop as runtime evidence.
- Treat driver closeout as LLM evidence.
- Keep Trusted skill identity as a separate blocked claim until Codex exposes an engine-owned skill invocation source.

## WOTS runs

- Run 1: `OpenAI Codex Stop hooks skill observability`
  - Window: 30 days.
  - Artifact: `/tmp/wots-codex-stop-hooks-skill-observability-1781261304/report.md`
  - Reddit: 1 thread.
  - X: 8 posts.
  - YouTube: 10 videos.
  - WOTS web: 0 pages.
- Run 2: `OpenAI Codex PreSkillUse PostSkillUse skill usage hooks observability`
  - Window: 30 days.
  - Artifact: `/tmp/wots-codex-skill-usage-hooks-observability-1781261398/report.md`
  - Reddit: 3 threads.
  - X: 7 posts.
  - YouTube: 0 videos.
  - WOTS web: 0 pages.

## Community signal

- Hooks are discussed as deterministic control infrastructure.
  - Common uses: block risky commands, scan prompts for secrets, inject context, validate before a turn stops, persist memory, and enforce standards.
  - Strong signal source: X post by Derrick Choi, 2026-05-19, 244 likes and 18 reposts, surfaced by WOTS.
- Skills are discussed as reusable workflow packaging.
  - Common uses: review loops, cross-agent review, reusable team workflows, and delegation to Codex.
  - Strong signal source: X post by Peter Steinberger, 2026-05-14, 2,725 likes and 149 reposts, surfaced by WOTS.
- Agent observability is discussed as a real market/category.
  - Common uses: token usage, cost, model behavior, tool calls, session activity, and team-level visibility.
  - Reddit source: SuperBased Observer thread, r/vibecoders_, 2026-05-13, surfaced by WOTS.
- Skill lifecycle observability is not yet a mature public pattern.
  - The closest signal is a feature request for `PreSkillUse` and `PostSkillUse`.
  - The request frames skill-use hooks as needed for telemetry, audit logging, debugging, policy checks, UX, and agent observability.

## Verified sources

- 2026-06-29 official Codex manual refresh:
  - Source: local `openai-docs` Codex manual fetch from `https://developers.openai.com/codex/hooks` and `https://developers.openai.com/codex/skills`.
  - Hooks listed: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `SessionStart`, and `SubagentStart`.
  - Skills docs still describe explicit and implicit skill activation.
  - No `PreSkillUse`, `PostSkillUse`, or equivalent engine-owned skill invocation event was found.
- OpenAI Codex hooks support lifecycle events including `Stop`.
  - Source: https://developers.openai.com/codex/hooks
  - Relevant facts:
    - `Stop` runs at turn scope.
    - Matching hooks from multiple sources all run.
    - Non-managed command hooks require review and trust before execution.
    - Project-local hooks load only when the project `.codex/` layer is trusted.
- OpenAI Codex skills can be explicit or implicit.
  - Source: https://developers.openai.com/codex/skills
  - Relevant facts:
    - Users can invoke skills explicitly.
    - Codex can choose a skill implicitly based on the skill description.
    - Skills use progressive disclosure and the full `SKILL.md` is read only after selection.
- OpenAI Codex OTel configuration exists for local clients.
  - Source: https://developers.openai.com/codex/config-advanced
  - Relevant facts:
    - Codex has local configuration for telemetry and integrations.
    - Project config cannot set `otel`; telemetry is not repo-owned project config.
- Public observability vendors are already documenting Codex monitoring.
  - SigNoz Codex monitoring: https://signoz.io/docs/codex-monitoring/
  - Oodle Codex observability: https://docs.oodle.ai/ai-agent-observability/codex
  - These sources support the market/category signal, not Trusted skill identity.
- A public OpenAI Codex issue requests `PreSkillUse` and `PostSkillUse`.
  - Source: https://github.com/openai/codex/issues/17132
  - Relevant fact:
    - The issue asks for first-class skill lifecycle hooks for explicit and implicit skill usage.
    - This is a request, not shipped support.

## Claims checked

- Verified: Codex has `Stop` hooks.
  - Official hooks docs list `Stop`.
- Verified: Codex hooks can support runtime validation and logging.
  - Official hooks docs list validation, logging, prompt scanning, and memory examples.
- Verified: Codex skills can be explicitly or implicitly invoked.
  - Official skills docs describe both activation modes.
- Verified: Community and vendors are treating agent observability as a serious category.
  - WOTS found community signal; SigNoz and Oodle publish Codex observability docs.
- Unverified: Codex currently exposes a stable skill invocation event.
  - No official `PreSkillUse`, `PostSkillUse`, or equivalent skill lifecycle event was found.
- Unverified: Codex Stop payload proves Trusted skill identity.
  - Official Stop-hook docs do not document a stable skill identity field.

## Pivot implications

- Evidence tiers fit the ecosystem.
  - `driver_declared`: driver closeout or LLM-authored closeout evidence.
  - `runtime_observed`: Codex Stop hook or OTel runtime evidence.
  - `corroborated`: driver closeout and runtime evidence linked by an explicit trusted id.
  - `trusted_engine_identity`: only an engine-owned skill invocation source.
- Stop hook success should not imply skill identity success.
- OTel success should not imply skill identity success.
- Closeout usefulness should not imply runtime capture success.
- A future `PreSkillUse` or `PostSkillUse` feature would likely become the clean Trusted skill identity source.
- Until then, the plan should keep closeout-first ledger work separate from Trusted identity readiness.

## Implications for Claude Code

- Claude Code can continue to be treated as the stronger live close-detection surface when its Stop hook plus transcript evidence names a completed skill tool call.
- Claude Code evidence still needs provenance labels because transcript-derived evidence is not the same as engine-owned Codex skill identity.
- Claude Code is useful for richer close-detection experiments, but it cannot prove Codex skill identity.

## Implications for Codex

- Codex Stop is the right runtime capture point.
- Codex Stop should produce runtime-observed reports even when skill identity remains blocked.
- Codex project hook trust and active hook source set matter because multiple matching hooks can run.
- Codex OTel can help with run/tool/session observability and correlation diagnostics.
- Codex does not yet provide the public skill lifecycle hook that would make `trusted_engine_identity` straightforward.

## Resolved decision points

- Decision 20 superseded the all-feature-work gate: v2 closeout-first ledger
  work may proceed from `driver_declared` evidence while Trusted skill identity
  remains blocked.
- Decision 20 kept `trusted_engine_identity` and daily-pilot readiness gated.
- Decision 29 allowed trusted run proof to support `same_trusted_run` and
  `corroborated` without satisfying Trusted skill identity.
- Decision 44 supports Claude Code as the current daily-pilot runtime and keeps
  Codex Stop runtime-observed while Codex Trusted skill identity remains
  deferred.
- Transcript inspection stays runtime-specific evidence for Claude Code and
  diagnostic-only context for Codex identity.
