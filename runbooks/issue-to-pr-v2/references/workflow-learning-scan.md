# Workflow Learning Scan

**Contract owner:** this reference owns Workflow Learning Scan orchestration:
when to run, what evidence to collect, output shape, read-only boundary,
ship-time handling, fail-stop handling, and relationship to gotchas.
Deterministic schema, enum values, scaffold output, and registry upsert
mechanics live in runtime/helper owners.

**Read trigger:** open this reference after PR URL confirmation and before the
final shipped checkpoint, or when a fail-stop reveals a workflow-level learning
worth capturing. A workflow-level learning is about the Issue-to-PR workflow
itself: skill links, runbook references, CLI/observability, workflow contracts,
or gotchas. Target deliverable bugs are findings, not workflow learnings.

## Principle

Ship the thing. Capture the learning. Make follow-up easy. Do not let meta-work
hijack delivery.

The scan is a read-only reflection pass over evidence already visible in the
run. It may propose metadata. It may not repair the workflow in place.

## Inputs

- Current route or fail-stop evidence.
- Per-issue ledger state and Notes.
- Local check, Builder, Validator, Proposer, PR, or helper output already
  produced by the run.
- Existing `## Workflow Learnings` ledger entries.
- Registry context from
  [workflow-learnings-registry.md](workflow-learnings-registry.md).
- Runtime contracts in `runbooks/issue-to-pr-v2/lib/learnings.ts`.

## Diagnostic Questions

- What Issue-to-PR surface was wrong, missing, confusing, or too hard to find?
- How did the run discover it?
- What root cause best explains it?
- How wide is the impact: this run only, one stage, many repos, every run?
- What concrete fix would retire the learning?
- How would a later agent verify the fix?
- Who owns the fix surface?
- Does evidence support `small-fix`, `file-follow-up`, `ignore`,
  `already-covered`, or `needs-evidence`?
- Is confidence low, medium, or high?
- Does follow-up block resume, unblock, or honest closure of this delivery?

## Outputs

When no workflow-level learning exists: write nothing for the scan.

When a learning exists, capture only run metadata:

- Ledger `## Workflow Learnings` entry with run-scoped evidence:
  `signature`, `affected_surface`, `what_was_wrong`, `discovery_method`,
  `root_cause`, `scope`, `proposed_fix`, `verification_idea`.
- Registry candidate with canonical and lifecycle metadata validated by the
  helper: summary, owner, retirement condition, signature, disposition, status,
  confidence, follow-up, evidence.
- Final learning summary: helper-emitted counts plus attention items only.

Owner, disposition, and confidence are scan proposals from evidence. Allowed
values and upsert behavior live in `lib/learnings.ts` and
[workflow-learnings-registry.md](workflow-learnings-registry.md).

## Runtime Pointers

- Validate the existing registry with `learnings-registry.ts --validate`.
- Upsert one registry entry with `learnings-registry.ts --upsert`.
- Validate and upsert ship-time candidate batches with
  `learnings-registry.ts --upsert-batch`.
- Discover empty ledger section scaffold with
  `cli.ts scaffold workflow-learnings-empty --json`.
- Keep PR #125 baseline pointer-only: do not recreate
  `runbooks/issue-to-pr-v2/issue-N-ledger.template.md`.

## Evidence Quality

- Prefer specific run evidence over general frustration.
- Name observable commands, routes, references, helper outputs, or missing links.
- Use `needs-evidence` when evidence is plausible but not actionable.
- Use `already-covered` when an existing reference or registry entry already
  addresses the learning.
- Use `ignore` only when the run evidence shows no workflow change is useful.

## Read-Only Boundary

During scan handling, do not patch:

- skills;
- runbook references;
- CLI/source code;
- docs;
- target deliverables;
- gotchas content.

Allowed writes, only when a learning exists:

- current per-issue ledger workflow-learning evidence;
- Workflow Learnings registry via `learnings-registry.ts --upsert-batch`.

Follow-up issue shaping stays outside the scan. Use `to-issues` only after
explicit approval.

## Final Learning Summary

Owned here. Stage 6 routes to this shape; do not define a parallel summary in
Stage 6.

- Counts: use `learnings-registry.ts --upsert-batch` JSON `counts` output.
- Attention items: scan judgment over the helper's per-candidate facts,
  disposition, confidence, and this delivery's closure context.
- Include high-confidence `file-follow-up` items that affect resume, unblock,
  or honest closure.
- Exclude full registry entries.
- Exclude full ledger `## Workflow Learnings` entries.

## Ship-Time Scan

Run after PR URL confirmation and before the final checkpoint commit.

Flow:

1. Record `pr_url`.
2. Run this read-only scan against the completed run evidence.
3. If learning found, append ledger evidence and validate/upsert the registry
   through the helper.
4. Include the final learning summary in the operator response.
5. Commit only final run metadata: per-issue ledger and Workflow Learnings
   registry.

- `small-fix` never blocks the final metadata checkpoint.
- High-confidence `file-follow-up` blocks only when follow-up is required to
  resume, unblock, or avoid closing the run with a known workflow defect still
  affecting this delivery.
- Lower-confidence, `needs-evidence`, `already-covered`, and `ignore` outcomes
  record without blocking delivery.

## Fail-Stop Scan

When a fail-stop exposes a workflow-level learning, capture evidence without
obscuring the resume condition.

Flow:

1. Record durable blocked state first when the stage requires it.
2. Surface the concrete blocker and resume condition.
3. If blocker evidence shows a workflow-level learning, run this scan as
   read-only reflection over the stop evidence.
4. Capture ledger evidence and registry metadata through helper surfaces when
   safe.
5. Ask before continuing only for a Resume-blocking Workflow Learning.
6. Stop with blocker/resume condition plus any Workflow Learning attention
   items.

Resume-blocking Workflow Learning: unresolved workflow defect that prevents
safe resume, unblock, or honest closure of this delivery. Examples: missing
helper command, ambiguous route contract, unsafe registry write target, docs
contradiction that prevents choosing the next route, or equivalent workflow
defect.

- `small-fix` records without blocking fail-stop recovery.
- `needs-evidence` records as weak evidence without blocking by default.
- `needs-evidence` is not a Workflow Learning attention item by default.
- High-confidence `file-follow-up` records without blocking when the follow-up
  is not needed to resume, unblock, or honestly close this delivery.
- Needed-to-resume `file-follow-up` is Resume-blocking and requires an ask
  before continuing.
- Workflow Learning metadata safety failure is Resume-blocking when registry
  target, helper command, or helper contract cannot safely preserve evidence.
- Weak evidence, no-learning outcomes, and ordinary upsert friction do not
  block resume.
- Every Resume-blocking Workflow Learning is a Workflow Learning attention item.

Fail-stop output:

- Lead with blocker and resume condition.
- Include only Workflow Learning attention items after recovery context.
- Suppress routine counts, no-learning capture status, and weak-evidence noise.
- Exclude full ledger entries, full registry entries, issue drafts, and
  `to-issues` invocation.

Do not repair during fail-stop scan handling. Do not patch skills, runbook
references, CLI/source code, docs, gotchas, target deliverables, or workflow
contracts as part of scan capture.

## Gotchas Relationship

`first-run-gotchas.md` remains symptom-first recovery guidance. A gotcha helps
an operator identify and recover from a confusing state.

Workflow Learnings owns cross-run attention, lifecycle, dedupe, confidence,
follow-up disposition, and retirement tracking. A gotcha can produce a learning;
the learning does not replace the recovery recipe.
