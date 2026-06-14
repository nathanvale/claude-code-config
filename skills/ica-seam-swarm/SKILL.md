---
name: ica-seam-swarm
description: "Run ICA seam swarm, seam assessment, candidate factory, adversary review, prompt pack, or resume/compress."
---

# ICA Seam Swarm

Run read-only ICA-style architecture assessments over folders treated as seams.
This skill owns routing, sharding, prompt packaging, synthesis, and confidence
filtering. `$improve-codebase-architecture` owns the ICA vocabulary and
deepening judgment.

## Load Order

1. Read [ROUTING.md](ROUTING.md) first when the request is terse, typo-heavy,
   scope-ambiguous, prompt-pack ambiguous, or dispatch authorization is unclear.
2. Read [RECIPES.md](RECIPES.md) after choosing the mode.
3. Read [ORCHESTRATION.md](ORCHESTRATION.md) before file listing, preflight,
   sharding, dispatch, or compression work.
4. Read [PROMPTS.md](PROMPTS.md) only when building worker or synthesis prompts.
5. Read [CANDIDATES.md](CANDIDATES.md) only for Candidate Factory lanes.
6. Read [PERSONAS.md](PERSONAS.md) and [PATTERNS.md](PATTERNS.md) only when
   assigning shard personas or prompt mechanics.

## Routing Rules

1. **Prompt Pack Only**: explicit request for dispatch prompts, a prompt pack,
   manual dispatch material, a swarm plan to run elsewhere, or a request not to
   use agents. Produce compact shared context, shard deltas, and prompts. Do
   not spawn.
2. **Standard Seam Swarm**: tight-seam assessment. Use a solo read-only pass
   unless agent dispatch is authorized; when authorized, run core shards and
   synthesize architecture tightness.
3. **ICA Candidate Factory**: discover cross-package opportunities, entropy
   lanes, DRY candidates, vocabulary candidates, ownership ambiguity, or shared
   Interface candidates. Produce candidates, not plans.
4. **Adversary Review**: pressure-test an existing seam report, candidate list,
   plan, or ADR. Produce weak/dropped/kept claims, falsification evidence, a
   confidence filter, and one next review prompt.
5. **Resume / Compress Swarm**: resume after a long or interrupted swarm. Build
   a compression handoff first, then continue from the smallest useful shard.

When a request matches multiple modes, prefer the narrowest output that answers
the current uncertainty. If prompt-pack and candidate language appear together,
use [ROUTING.md](ROUTING.md) to disambiguate intent before gathering files.

## Terse Invocation Router

For shorthand such as `ba browse plugin`, stop before file listing. Present a
numbered router with a recommendation. First run cheap target resolution:
verify an exact user-supplied path exists, or verify a shorthand / alias maps
to one unambiguous path or concept. If target confidence is ambiguous, list the
plausible target alternatives before asking for a number.

Do not print context packets, file inventories, worker prompts, synthesis
prompts, or preflight summaries in a router turn.

## Agent Dispatch Authorization

Only dispatch subagents when one of these is true:

- The user explicitly asks to run a multi-agent swarm, spawn agents, dispatch
  agents, use architecture agents, or run review agents.
- The user chooses a router option that explicitly says it will dispatch
  read-only subagents.
- The user resumes an already-dispatched swarm and asks to continue it.

Bare mentions of this skill, `seam swarm`, or `swarm` without an action verb
are routing ambiguity, not dispatch authorization.

If the user merely asks whether a folder is a tight seam, use a solo read-only
pass by default, or present the router when budget or scope is a real choice.

## Execution Flow

1. Identify the seam and selected mode.
2. Confirm dispatch authorization or choose solo / prompt-pack behavior.
3. Gather the complete file list with explicit generated/vendor exclusions.
4. Read nearby AGENTS.md, CONTEXT.md, package maps, and relevant ADRs or
   runbooks.
5. Build the XML-shaped context packet from [PROMPTS.md](PROMPTS.md).
6. Run the orchestrator preflight from [ORCHESTRATION.md](ORCHESTRATION.md).
7. Split into independent shards, or run the solo pass.
8. Synthesize with the mode-specific output contract in [PROMPTS.md](PROMPTS.md).
9. Apply the adversary / weak-finding filter before finalizing.
10. Stop at evidence and follow-up prompts. Do not modify code or docs unless
   the user explicitly asks for follow-up implementation.

## Bridge Rules

Use `$decision-mode` only for real choices: mode, budget, seam scope, shard
shape, dispatch-vs-prompt-pack, custom lanes, or follow-up owner.

Use `$grill-with-docs` before dispatch only when scope or language is blocking
prompt quality. Use it after synthesis only when a surviving candidate may
become durable vocabulary, an ADR, package CONTEXT.md, package AGENTS.md,
package-map, or runbook work.

Do not run `grill-with-docs` inside worker agents.
