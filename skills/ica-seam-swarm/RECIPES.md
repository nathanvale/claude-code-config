# ICA Seam Swarm Recipes

Use these recipes after choosing a mode from `SKILL.md`. Each recipe gives the
operator flow only: trigger, gather, shards, output, and stop condition.

## Table of Contents

- [Budget Levels](#budget-levels)
- [Decision Mode Check](#decision-mode-check)
- [Grill-With-Docs Bridge Check](#grill-with-docs-bridge-check)
- [No-Findings States](#no-findings-states)
- [Prompt Pack Only](#prompt-pack-only)
- [Router Output Budget](#router-output-budget)
- [Standard Seam Swarm](#standard-seam-swarm)
- [ICA Candidate Factory](#ica-candidate-factory)
- [Adversary Review](#adversary-review)
- [Resume / Compress Swarm](#resume--compress-swarm)

## Budget Levels

Choose the smallest budget that answers the current uncertainty.

| Budget | Use when | Shape |
| --- | --- | --- |
| Prompt-only | The user explicitly asks for prompts, a prompt pack, manual dispatch material, or a swarm plan to run elsewhere. | No agents; prepare compact shared packet, shard deltas, and prompts. |
| Solo pass | The seam is small, low-risk, the user wants a quick read, or the user asks whether a folder is tight without authorizing agents. | One architecture reviewer covers the main question. |
| Three-shard swarm | The seam has meaningful uncertainty, a narrow scope, and agent dispatch is authorized. | Full seam pass, Interface/deletion test, and leak/adapters or candidate lane. |
| Full 3-6 shard swarm | The seam is large, high-blast-radius, or explicitly requested as a full swarm, and agent dispatch is authorized. | Core shards plus relevant optional lanes. |
| Adversary pass | The user has an existing report, plan, ADR, or candidate list to pressure-test. | Solo adversary pass by default; dispatch weak-finding / adversary reviewers only when agent dispatch is authorized. |

Scale up when:

- The file list is large, cross-package, or has multiple nested seams.
- The user asks for Candidate Factory, custom lanes, or full seam pass.
- Ownership, public Interface shape, or ADR conflict is uncertain.
- The top move would affect multiple callers, packages, or docs.
- Independent confirmation would materially change confidence.

Scale down when:

- The user only wants prompt material.
- The seam is tiny or the change is obviously local.
- Existing context already answers the question.
- The request is adversary-only against an existing artifact.
- The user asks for a quick read or limited budget.

## Decision Mode Check

This is an orchestrator routing check, not a budget level.

Before dispatch or prompt-pack generation, use `decision-mode` only when there
is a real choice about mode, budget, seam scope, shard shape,
dispatch-vs-prompt-pack, custom lanes, or follow-up owner. Offer the smallest
useful choice, recommend one option, then continue with the chosen recipe.

Do not use `decision-mode` for routine defaults, no-findings states, worker
prompts, or reversible details already implied by the user's request.

## Grill-With-Docs Bridge Check

This is a routing check, not a budget level.

Before dispatch, pause for `grill-with-docs` only when the seam's scope,
ownership language, or candidate-lane meaning is unclear enough to make the
worker prompts unstable. Ask the smallest decision question, give the
recommended answer, and continue once the scope or language is settled.

After synthesis, route to `grill-with-docs` only for surviving candidates that
may become durable vocabulary, ADRs, or package-constitution work. Do not use it
for ordinary implementation plans, local cleanup, or no-findings outcomes.

## No-Findings States

No-findings outcomes are successful when evidence supports them. Use the most
specific state that fits:

- **Tight Seam**: reviewed evidence supports the seam as tight enough.
- **No Candidate Backlog**: Candidate Factory found no defensible candidates.
- **Insufficient Evidence**: file/context evidence is too thin to conclude.
- **Known Transitional Only**: evidence maps to accepted or already-planned
  transition work.
- **Out of Scope**: the requested claim needs evidence outside the scope lock.

When a no-findings state applies, stop cleanly. Do not invent a weak finding to
fill the report.

## Prompt Pack Only

**Trigger**: The user explicitly asks for dispatch prompts, a prompt pack,
manual dispatch material, a swarm plan to run elsewhere, or says not to spawn
agents. Absence of an explicit agent-spawn request is not enough.

**Default budget**: Prompt-only.

**Gather**:

- Seam path or conceptual area.
- Complete file-list recipe and exclusions.
- Root and nearest package AGENTS.md, CONTEXT.md, package maps, and directly
  constraining ADRs or runbooks.
- Requested shard focus, custom lanes, and output format.
- Whether `decision-mode` is needed because prompt-pack vs dispatch, shard
  shape, or follow-up owner is a real choice.
- Whether the `grill-with-docs` bridge is needed before producing dispatchable
  prompts because scope, ownership language, or candidate-lane meaning is
  unresolved.

**Shards**:

- Do not dispatch agents.
- Prepare shard names, personas, assigned file scopes, prompt mechanics, and
  worker prompts.

**Output**:

- Compact orchestrator preflight summary.
- Compact shared context packet.
- Complete file list once in the shared packet.
- File-list command, count, exclusions, and scoped file groups.
- Shard plan.
- Per-shard prompt deltas and synthesis prompt.
- Full expanded worker prompts only when the user asks for full prompts.

**Stop condition**: The user has enough prompt material to dispatch the swarm
manually or ask you to run it.

## Router Output Budget

For terse invocation, scope-ambiguous, or router turns, keep output
compact: one question, numbered options, the recommended option, and what will
happen next. Do not print worker prompts, full context packets, or long file
inventories until the user chooses Prompt Pack Only or asks for full prompts.
Use the `<request_intake>` and `<router_output>` rails from `ROUTING.md` to make
this decision before file listing or context gathering.

Orchestrator preflight is a later phase after the user has selected a mode and
scope; do not collapse preflight into this router output budget.

## Standard Seam Swarm

**Trigger**: The user asks whether a folder, package, or file set is a tight
Seam.

**Default budget**: Solo pass unless agent dispatch is authorized. After
explicit swarm/agent wording or router confirmation, use three-shard swarm.
Scale up to full 3-6 shard swarm for large, cross-package, or high-blast-radius
seams. Scale down to solo pass for a small, low-risk seam.

**Gather**:

- Complete file list under the seam.
- Ownership and non-ownership from local context documents.
- Package maps and directly constraining ADRs or runbooks.
- Any user-specified scope lock.
- Whether `decision-mode` is needed because budget, seam scope, or shard shape
  has multiple viable options.

**Shards**:

- Full seam pass.
- Interface width / exported surface.
- Deletion test.
- Cross-folder leaks / Adapter placement.
- Missing Seam candidates.
- ADR / package constitution conflicts when directly relevant.

**Output**:

- Use the Standard Seam Swarm synthesis output contract in [PROMPTS.md](PROMPTS.md).
- Solo passes use the same final structure as a dispatched swarm; the worker
  output contract is only for shard returns.
- Seam tightness verdict.
- Consolidated findings.
- Deletion-test table.
- Missing Seam candidates.
- Confidence filter.
- Next review prompt.

**Stop condition**: The report answers whether the seam is tight and identifies
the top Locality / Leverage moves, or ends in a no-findings state.

## ICA Candidate Factory

**Trigger**: The user asks for architecture candidates, cross-package
opportunities, entropy audit, DRY audit, shared Interface candidates, custom
lanes, or asks to discover follow-up candidates. If the user asks only for
prompt material for already-known candidates, use Prompt Pack Only.

**Default budget**: Solo pass unless agent dispatch is authorized. After
explicit swarm/agent wording or router confirmation, use three-shard swarm.
Scale up to full 3-6 shard swarm when multiple candidate lanes or cross-package
evidence are in scope. Scale down to solo pass for one narrow custom lane.

**Gather**:

- One or more seams or folders to compare.
- Complete file lists for each reviewed area.
- Core entropy lanes from `CANDIDATES.md`.
- Any user-specified lanes for this run.
- Ownership context and relevant package maps.
- Whether `decision-mode` is needed because candidate lanes, comparison scope,
  or follow-up owner has multiple viable options.

**Shards**:

- Repetition / DRY.
- Vocabulary.
- Ownership ambiguity.
- Missing Seam.
- Public Interface width.
- User-specified lanes.
- Derived ADR follow-ups only when another lane exposes a durable trade-off.

**Output**:

- Candidate backlog grouped by lane.
- Evidence, likely owner, ICA framing, confidence, and follow-up prompt for
  each candidate.
- Confidence filter that drops ordinary cleanup and taste-only feedback.
- `grill-with-docs` follow-up prompt only when durable vocabulary, ADR, or
  package-constitution work may result.

**Stop condition**: Each surviving candidate is ready for ICA grilling,
`grill-with-docs`, ADR drafting, package-context deepening, or no action, or
the output ends in **No Candidate Backlog**.

## Adversary Review

**Trigger**: The user asks to pressure-test an existing seam report, candidate
backlog, plan, ADR, or recommendation.

**Default budget**: Solo adversary pass unless agent dispatch is authorized.
Dispatch adversary reviewers only when the user explicitly asks for review
agents, a swarm, or chooses a dispatch-authorizing router option. Add a solo
evidence pass when the artifact cites evidence that must be verified before
critique.

**Gather**:

- Existing report or candidate list.
- Evidence cited by the original report.
- Known transitional work, accepted ADRs, and package constitution facts.
- User's risk focus, if any.
- Whether `decision-mode` is needed because critique budget, evidence pass, or
  follow-up owner has multiple viable options.

**Shards**:

- Solo pass: cover weak-finding, falsification, confidence filter, and next
  review prompt in one local pass.
- If dispatch is authorized: Adversary Reviewer.
- If dispatch is authorized and governance conflict is part of the claim:
  ADR / Constitution Counsel.
- If dispatch is authorized and the input is long: Compression Editor.

**Output**:

- `## Adversary Review`: weak, overfit, duplicate, transitional, taste-only,
  unsupported, and kept claims; what evidence would falsify the top
  recommendation; and which candidates should not become ADRs, context terms,
  or implementation plans yet.
- `## Confidence Filter`: upgraded, downgraded, dropped, and known-transitional
  claims.
- `## Next Review Prompt`: one next review prompt.

**Stop condition**: The remaining claims are defensible, the report is returned
as not ready, or all claims are dropped into a no-findings state.

## Resume / Compress Swarm

**Trigger**: The user resumes after a long swarm, context handoff, interruption,
or multi-batch agent run.

**Default budget**: Solo pass with Compression Editor. Scale up only for the
smallest unresolved shard needed to answer the current uncertainty.

**Gather**:

- Latest compression handoff.
- Completed shards and personas.
- Strongest evidence, conflicts, weak/dropped claims, and open questions.
- Current user request.
- Whether `decision-mode` is needed because the next shard or follow-up owner is
  a real choice.

**Shards**:

- Compression Editor first.
- The smallest next shard needed to answer the current uncertainty.
- Adversary Reviewer before final synthesis when findings changed.

**Output**:

- Updated compression handoff.
- Answer to the current uncertainty.
- Remaining gaps and next shard, if any.

**Stop condition**: The swarm can continue without rediscovery, or the current
question is answered with a final report.
