---
target_skill: skills/skill-self-audit-loop/fixtures/fixture-negative-near-miss/SKILL.md
status: converged
passes: 1
last_pass: 2026-06-10
convergence: converged
---

# Skill Self-Audit Loop: fixture-negative-near-miss

## Truth Stance

- This file is audit state.
- This file is not canonical skill instruction.
- Research explains loop shape only.
- Findings require local source evidence.
- Repair source through `skills/create-skill/SKILL.md`.
- Add a helper only after real loop files show ledger-shape drift, duplicate-signature confusion, false convergence claims, or privacy-redaction drift; use `skills/create-cli/SKILL.md` first.

## Driver Commands

Short path:

```text
/goal Read docs/skill-audits/fixture-negative-near-miss/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/fixture-negative-near-miss/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/fixture-negative-near-miss/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `fixture-negative-near-miss`
- Target path: `skills/skill-self-audit-loop/fixtures/fixture-negative-near-miss/SKILL.md`
- Audit file: `docs/skill-audits/fixture-negative-near-miss/self-audit-loop.md`

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.
- Do not run `/goal` or `/loop` from the loop-creation skill.

## Loaded Owner Paths

- `skills/create-skill/references/skill-design-decision-runbook.md`
- `skills/skill-self-audit-loop/fixtures/fixture-negative-near-miss/SKILL.md`
- `skills/create-skill/SKILL.md` (named repair owner)

## Skipped Owner Paths

- None.

## Pass Ledger

- Pass 1 (2026-06-10): audited the near-miss fixture for authority/scope/lifecycle/safety contradictions. Examined the surface tension between Workflow step 3 ("write the change to a new output file beside the target") and Safety ("Never overwrite the original target file" / "Write only to a new output file, never in place"). Resolved clean: writing to a new file beside the target honors the never-in-place safety rule; dry-run and apply modes are mutually exclusive behind an explicit flag, so no instruction demands behavior another forbids. Accepted contradictions: 0. Converged.
- Stability check (2026-06-10): 3 independent blind audit agents judged this fixture. All 3 returned `clean` with identical reasoning (the "write" verb is surface tension; new-file-beside-target resolves it). 0 flips. Paired with the positive fixture's 3/3 `accept`, the accept bar is stable and correctly calibrated in both directions.

## Open Findings

- None.

## Finding History

- REJ-1 (`write-verb-vs-never-overwrite`), status: rejected (not a contradiction — surface tension resolves clean). Workflow step 3 "write the change to a new output file beside the target" vs Safety "Never overwrite the original target file" / "Write only to a new output file, never in place." Both followable: the write targets a new file, never the original. Mode gating (dry-run default, apply only on explicit flag) means the steps never co-fire destructively. No safety/scope conflict.

## Unresolved Questions

- None.

## Dedupe Warnings

- None.

## Repair Candidates

- None.

## Stop Rule

- Converged: a fresh pass adds zero new accepted contradictions.
- Active: at least one open finding remains or the next pass is needed.
- Blocked: evidence is missing, authority is unclear, loop state is corrupt, privacy prevents recording evidence, or a human decision is required.
- Dedupe warnings do not block convergence by themselves.
- Maximum-pass limits are cost guards, not proof of convergence.

## Research Anchors

- `docs/brainstorms/2026-06-10-skill-self-audit-loop-v2-requirements.md`

## Next Safe Action

- Converged; near-miss correctly rejected. This fixture is a durable negative-control regression: re-run after any Contradiction Rule change to confirm the bar still rejects near-misses.
