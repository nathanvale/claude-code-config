---
name: ac-convergence
description: "Drive acceptance criteria to zero-findings convergence: fan-out test harvest, triage, findings JSON handoff, synthesis patch. Use when a Jira AC ledger has open findings and the goal is to close them with fixture-backed tests + live verdicts."
role: tool-workflow
---

# AC Convergence

Use when a ledger of open Jira ACs needs to reach zero findings — each AC gets:
accepted + fixture-captured + test-written + live-conformance-verdict.

Manual invocation only — missed runs lose convergence state.

## Owner Map

- Skill: `skills/ac-convergence/SKILL.md`
- Findings schema: `references/findings-schema.md`
- Phase guide: `references/phase-guide.md`
- Test runner: `skills/test-runner/SKILL.md`
- Context advisor: `skills/context-advisor/SKILL.md`

## Pick One

- **Run the full workflow** (harvest → triage → synthesise): read `references/phase-guide.md`.
- **Understand the findings handoff contract**: read `references/findings-schema.md`.
- **Check what ledger/runbook to target**: read the repo's nearest AC runbook.

## Workflow

Three phases. Each phase hands a JSON payload to the next.

### Phase 1 — Harvest

Fan out one agent per AC cluster (e.g. component-tier vs live-host-tier):

1. Run `skills/test-runner/SKILL.md` in triage mode against the cluster's test files.
2. Each agent returns `{ac_id, tier, status, error, fixture_path}` per failing test.
3. Collect all findings lists into a single array — no synthesis yet.

### Phase 2 — Triage

Single agent ingests the findings array and:

1. Deduplicates by root cause (same fixture gap → one finding).
2. Tags each finding: `fixable-now` | `blocked-backend` | `needs-fixture` | `flake`.
3. Prioritises: `fixable-now` first, then `needs-fixture`.
4. Emits the triage manifest (JSON) — the handoff artefact.

See `references/findings-schema.md` for the full envelope.

### Phase 3 — Synthesise

Receives the triage manifest. Patches the ledger:

1. Updates verdict rows (PASS / FAIL / BLOCKED / PARTIAL).
2. Writes new fixture-backed test stubs for `needs-fixture` findings.
3. Emits a convergence delta report: what moved, what's still open, root-cause clusters.
4. Outputs a next-action list ordered by unblocking impact.

## Output Handling

- Phase 1 → Phase 2: raw findings array (JSON).
- Phase 2 → Phase 3: triage manifest (JSON).
- Phase 3 → ledger: direct patch to the ledger file; delta report to stdout.
- Keep intermediate JSON under `var/ac-convergence/` unless deliberately promoted.

## Safety

- Default to dry-run on ledger writes — require explicit execute mode.
- Never mark an AC as PASS without a fixture-backed test that asserts it.
- Stop as blocked if the triage manifest has no `fixable-now` findings and synthesis would overwrite live verdicts.

## Next Safe Action

- No ledger yet: find the repo's nearest AC runbook before starting Phase 1.
- Ledger exists with open findings: start Phase 1 — fan out by AC tier.
- Phase 1 complete: hand the findings array to Phase 2 triage agent.
- Phase 2 complete: hand the triage manifest to Phase 3 synthesis agent.
- Phase 3 complete: review the delta report and commit the ledger patch.
- Blocked on backend: record the blocked ACs in the ledger and stop — do not fabricate verdicts.
