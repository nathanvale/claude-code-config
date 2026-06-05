---
date: 2026-06-05
topic: fallow-why-resolver
focus: Fallow runner `why` resolver after audit attribution
mode: repo-grounded
---

# Ideation: Fallow `why` Resolver

## Grounding Context

- Repo shape: agent config repo with skills, rules, docs, and Bun/TypeScript scripts.
- Fallow owner paths:
  - `skills/fallow/scripts/fallow-runner.ts`
  - `skills/fallow/scripts/command-contract.ts`
  - `skills/fallow/scripts/fallow-runner.test.ts`
  - `skills/fallow/SKILL.md`
  - `skills/fallow/references/workflows.md`
- Current workflow: `audit --plain` is the default implemented-work check.
- Current workflow: audit attribution separates introduced from inherited findings.
- Current invariant: `introduced=0` means stop without per-finding triage.
- Current gap: non-audit modes still lack attribution and use coverage-intersect.
- Prototype fact: `trace_export` via mcporter resolved real `remove-export` false positives.
- Prototype fact: `trace_export` requires `{file, export_name}`.
- Prototype fact: bare symbol lookup is insufficient.
- Prior learning: per-finding `actions[]` is broader agent actionability than `why`.
- Prior learning: baseline/regression may beat `why` for verification.
- External signal: Fallow, Knip, and TypeScript separate graph explanation from routine finding lists.
- External signal: MCP structured results favor stable schemas over prose-only explanation.

## Topic Axes

- Decision timing
- Invocation ergonomics
- Evidence/action mapping
- Transport/ownership
- Broader trace strategy

## Ranked Ideas

### 1. Per-Finding Resolver Actions Before Standalone `why`

**Description:** Surface trace as a typed `actions[]` entry on eligible findings. A finding advertises `trace_export`, `coverage_intersect`, `baseline_compare`, or `delete_candidate` only when the runner has the required input shape.

**Axis:** Evidence/action mapping

**Basis:** `direct:` `docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md` ranks per-finding `actions[]` before `why`; grounding says actions expose mechanical fixes and suppress comments across more cases.

**Rationale:** Agents need the next safe action at the finding, not another command to remember.

**Downsides:** Requires action schema work before the satisfying `why` demo.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 2. Audit-Gated `why` Continuation

**Description:** Build `why` only as a continuation from an actionable finding. If audit attribution says `introduced=0`, do not prompt or run per-finding trace. If a finding is introduced and traceable, expose the resolver action.

**Axis:** Decision timing

**Basis:** `direct:` `skills/fallow/references/workflows.md` says `next_action=continue introduced=0` means stop without per-finding triage.

**Rationale:** This preserves the new attribution win and prevents `why` from reviving noisy audit habits.

**Downsides:** Less useful for ad hoc cleanup unless paired with non-audit attribution or explicit manual mode.

**Confidence:** 86%

**Complexity:** Low

**Status:** Unexplored

### 3. Finding-ID First, Coordinates Fallback

**Description:** Prefer `why <finding-id>` when a prior runner envelope has exact file/export data. Keep `why <file> <export>` or `why <file>#<export>` as the explicit fallback when no finding context exists.

**Axis:** Invocation ergonomics

**Basis:** `direct:` `skills/fallow/scripts/prototype-why-symbol/NOTES.md` proves trace needs file plus export name; the runner already emits structured issue references.

**Rationale:** The user should not retype coordinates the tool already knows.

**Downsides:** Requires stable finding ids or resolver metadata in issue references.

**Confidence:** 78%

**Complexity:** Medium

**Status:** Unexplored

### 4. Evidence Grade Before Verdict

**Description:** Return evidence grades such as `referenced`, `entry_point`, `unreferenced_by_trace`, `unresolved`, and `trace_unavailable`. Avoid making `likely-dead` alone the deletion permission.

**Axis:** Evidence/action mapping

**Basis:** `reasoned:` Static graph trace shows reachability under configured roots; it does not prove runtime deletion safety in every framework or dynamic edge case.

**Rationale:** Evidence grades keep the runner honest while still making decisions faster.

**Downsides:** Slightly less decisive plain output than `false-positive` / `likely-dead`.

**Confidence:** 82%

**Complexity:** Low

**Status:** Unexplored

### 5. Fallow-Owned Mcporter Evidence Adapter

**Description:** Keep mcporter private behind a Fallow-owned adapter. The adapter owns input validation, command vector resolution, timeout behavior, tool-vs-transport error mapping, and runner-facing evidence schema.

**Axis:** Transport/ownership

**Basis:** `direct:` `docs/plans/2026-06-05-002-feat-fallow-why-subcommand-plan.md` already proposes a fallow-owned adapter; the prototype rejects a bespoke MCP client.

**Rationale:** Fallow owns the contract; mcporter supplies graph observations.

**Downsides:** Some duplication with `browser-use/scripts/mcporter-transport.ts` remains.

**Confidence:** 84%

**Complexity:** Low

**Status:** Unexplored

### 6. Baseline/Regression Before Broader Trace

**Description:** Prioritize non-audit baseline/regression proof before broadening trace. Let trace target only findings that survive "is this new or worse?" checks.

**Axis:** Broader trace strategy

**Basis:** `direct:` `docs/plans/2026-06-05-001-feat-fallow-agent-actionability-plan.md` identifies non-audit baseline/regression as high value because `dead-code`, `health`, and `dupes` lack attribution.

**Rationale:** Explanation is most useful after the runner proves the finding deserves attention.

**Downsides:** Does not capitalize immediately on the proven mcporter spike.

**Confidence:** 74%

**Complexity:** Medium

**Status:** Unexplored

### 7. Resolver Registry By Finding Kind

**Description:** Register explainers by finding kind, starting with `remove-export -> trace_export`. Findings advertise available resolvers through metadata; command dispatch stays generic.

**Axis:** Broader trace strategy

**Basis:** `external:` Knip and TypeScript expose multiple graph explanation surfaces; Fallow MCP exposes trace tools beyond one export resolver.

**Rationale:** This gives `why` room to grow without baking one finding kind into the CLI forever.

**Downsides:** Risk of frameworking too early unless v1 keeps only one registered resolver.

**Confidence:** 68%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

- Routine audit `why`: rejected because audit attribution already handles zero-introduced stop.
- Bare symbol `why`: rejected because prototype proved symbol alone is insufficient.
- `why <file> <export>` only: kept as fallback, rejected as primary UX because findings can carry coordinates.
- Full graph `trace` command family now: rejected as scope overrun before one resolver proves durable.
- Batch trace resolver now: rejected as premature optimization over the single-finding decision path.
- Trace artifact ledger: rejected as useful later, too much persistence surface now.
- One-shot trace during audit only: rejected because ad hoc cleanup still needs a manual resolver path.
- Shared mcporter package now: rejected because a fallow-owned adapter is cheaper; revisit after a third consumer.
- `likely-dead` as top-level status: rejected because it overclaims deletion safety.
- Explanation prose first: rejected because structured actions and evidence grades serve agents better.

## Recommended Next Brainstorm

- Seed: "Per-finding resolver actions before standalone `why`."
- Decision to resolve: whether `why` exists as a visible subcommand, an action target, or both.
- Constraint: preserve audit attribution as the first gate.
- Constraint: require discovery metadata, help, parser acceptance, and runtime semantics before any new CLI surface ships.
