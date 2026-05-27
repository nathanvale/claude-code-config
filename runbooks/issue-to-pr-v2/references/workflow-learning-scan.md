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
- Final attention summary: count new/updated/ignored learnings; list every
  `file-follow-up` item.

Owner, disposition, and confidence are scan proposals from evidence. Allowed
values and upsert behavior live in `lib/learnings.ts` and
[workflow-learnings-registry.md](workflow-learnings-registry.md).

## Runtime Pointers

- Validate registry candidates with `learnings-registry.ts --validate`.
- Upsert registry entries with `learnings-registry.ts --upsert`.
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
- Workflow Learnings registry via `learnings-registry.ts --upsert`.

Follow-up issue shaping stays outside the scan. Use `to-issues` only after
explicit approval.

## Ship-Time Scan

Run after PR URL confirmation and before the final checkpoint commit.

Flow:

1. Record `pr_url`.
2. Run this read-only scan against the completed run evidence.
3. If learning found, append ledger evidence and validate/upsert the registry
   through the helper.
4. Include every `file-follow-up` item in the final attention summary.
5. Commit only final run metadata: per-issue ledger and Workflow Learnings
   registry.

`file-follow-up` blocks the final checkpoint only when follow-up is required to
resume, unblock, or avoid closing the run with a known workflow defect still
affecting this delivery.

## Fail-Stop Scan

When a fail-stop exposes a workflow-level learning, capture evidence without
obscuring the resume condition.

- Surface the concrete blocker first.
- Run the scan as reflection over the blocker evidence.
- Record learning metadata only when useful.
- Ask for follow-up confirmation only when follow-up is needed to resume,
  unblock, or honestly close this delivery.
- Do not write full follow-up issue text inside the scan.

## Gotchas Relationship

`first-run-gotchas.md` remains symptom-first recovery guidance. A gotcha helps
an operator identify and recover from a confusing state.

Workflow Learnings owns cross-run attention, lifecycle, dedupe, confidence,
follow-up disposition, and retirement tracking. A gotcha can produce a learning;
the learning does not replace the recovery recipe.
