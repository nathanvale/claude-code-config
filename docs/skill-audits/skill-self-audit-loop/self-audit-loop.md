---
target_skill: skills/skill-self-audit-loop/SKILL.md
status: converged
passes: 2
last_pass: 2026-06-10
convergence: converged
---

# Skill Self-Audit Loop: skill-self-audit-loop

## Truth Stance

- This file is audit state.
- This file is not canonical skill instruction.
- Research explains loop shape only.
- Findings require local source evidence.
- Repair source through `skills/create-skill/SKILL.md`.
- Add a helper only after real loop files show ledger-shape drift, duplicate-signature confusion, false convergence claims, or privacy-redaction drift; use `skills/cli-author/SKILL.md` first.

## Driver Commands

Short path:

```text
/goal Read docs/skill-audits/skill-self-audit-loop/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/skill-self-audit-loop/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/skill-self-audit-loop/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `skill-self-audit-loop`
- Target path: `skills/skill-self-audit-loop/SKILL.md`
- Audit file: `docs/skill-audits/skill-self-audit-loop/self-audit-loop.md`

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.
- Do not run `/goal` or `/loop` from the loop-creation skill.

## Loaded Owner Paths

- `skills/skill-self-audit-loop/SKILL.md`
- `skills/create-skill/SKILL.md`
- `skills/create-skill/references/skill-design-decision-runbook.md`
- `skills/context-advisor/references/storage-routing.md`
- `skills/cli-author/SKILL.md`
- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`

## Skipped Owner Paths

- `skills/cli-author/references/cli-guidelines.md`: skipped because v0 creates no helper or CLI surface.
- `skills/cli-author/references/agent-native-cli-design.md`: skipped because v0 creates no helper or agent-native CLI surface.
- `skills/cli-author/references/cli-command-facade.md`: skipped because v0 creates no facade-backed CLI surface.

## Pass Ledger

- Pass 1 (2026-06-10): audited target `SKILL.md` against owner paths for authority, scope, lifecycle, and safety contradictions. Read all loaded owner paths; verified skipped CLI references exist and the v0 no-helper/no-CLI/no-facade justification holds. Accepted contradictions: 0. One sub-threshold observation recorded as an unresolved question (UQ-1). Baseline pass — convergence not yet provable.
- Pass 2 (2026-06-10): fresh re-audit of all four conflict shapes; resolved UQ-1 against the brainstorm and SKILL.md Workflow step 9 / Updating-Existing-Files. Accepted contradictions: 0 new. UQ-1 closed as not-a-contradiction. Convergence reached: a fresh pass added zero new accepted contradictions.

## Open Findings

- None.

## Finding History

- UQ-1 (`template-omits-driver-ban`), status: resolved (not a contradiction). The Loop File Template `## Scope` (SKILL.md 129-132) omits the "Do not run `/goal` or `/loop`" line that Workflow step 9 (SKILL.md 31) and this file's `## Scope` carry. Resolution: not a hard conflict. The driver-ban is owned by Workflow step 9, which binds the skill driver unambiguously; the template `## Scope` is a minimal seed that the Updating-Existing-Files rule (SKILL.md 186) lets the driver refresh per file. Both instructions can be followed simultaneously — the driver never runs `/goal`/`/loop`, regardless of whether a generated file's Scope restates it. No repair candidate; no source edit warranted.

## Unresolved Questions

- None.

## Dedupe Warnings

- None.

## Candidate Shapes

- CS-1 (`cross-source`), status: out-of-shape, count: 1, blast-radius: high.
  - Case (mutation test 2026-06-10): a skill workflow says "run `git add -A`" while the global `AGENTS.md` says "never use `git add -A`." Real hard conflict; both cannot be followed.
  - Why out-of-shape: the conflict is between the skill and a global rule (or another skill), outside the one-target + owner-path audit scope. The blind auditor correctly returned clean and declined to force a shape.
  - Promotion note: may resolve to "keep out of scope" — auditing one skill against all global rules is a deliberate v0 scope bound. High blast-radius (could stage secrets / clobber unrelated work) argues for revisiting.
- CS-2 (`temporal-ordering`), status: out-of-shape, count: 1, blast-radius: medium.
  - Case (mutation test 2026-06-10): workflow step 2 deletes the directory that step 3 then needs. Each step alone is followable; the order makes step 3 impossible.
  - Why out-of-shape: a single-source step-ordering defect, not a conflict between two sources; `lifecycle` covers loop/finding state, not workflow step order. The blind auditor declined to force it into `lifecycle`.
  - Promotion note: a genuine conflict class the accepted shapes do not cover; promote if it recurs, gated by a fresh mutation test.

## Repair Candidates

- None.

## Stop Rule

- Converged: a fresh pass adds zero new accepted contradictions.
- Active: at least one open finding remains or the next pass is needed.
- Blocked: evidence is missing, authority is unclear, loop state is corrupt, privacy prevents recording evidence, or a human decision is required.
- Dedupe warnings do not block convergence by themselves.
- Maximum-pass limits are cost guards, not proof of convergence.

## Research Anchors

- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`
- `docs/research/loop-engineering-patterns/09-self-auditing-loop.html`
- `docs/research/2026-06-09-agentic-loop-community-signal.md`
- `docs/research/2026-06-10-loop-engineering-handoff.md`

## Next Safe Action

- Converged at pass 2; no further passes needed. Reopen only if the target `SKILL.md` or a named owner path changes. No repair candidates — `skills/create-skill/SKILL.md` has nothing to patch from this loop.
