---
target_skill: skills/create-cli/SKILL.md
status: converged
passes: 2
last_pass: 2026-06-10
convergence: converged
---

# Skill Self-Audit Loop: create-cli

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
/goal Read docs/skill-audits/create-cli/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/create-cli/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/create-cli/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `create-cli`
- Target path: `skills/create-cli/SKILL.md`
- Audit file: `docs/skill-audits/create-cli/self-audit-loop.md`

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.
- Do not run `/goal` or `/loop` from the loop-creation skill.

## Loaded Owner Paths

- `skills/create-skill/references/skill-design-decision-runbook.md`
- `skills/create-cli/SKILL.md`
- `skills/create-cli/references/cli-guidelines.md`
- `skills/create-cli/references/agent-native-cli-design.md`
- `skills/create-cli/references/cli-command-facade.md`
- `skills/create-cli/references/behavior-regression-checklist.md`
- `docs/adr/0009-create-cli-uses-bounded-local-extension.md` (existence verified)
- `runtime/cli-command-facade/` owner paths (existence verified: `AGENTS.md`, `CONTEXT.md`, `src/index.ts`, `src/command-facade.ts`, `src/cli-diagnostics.ts`, `src/testing.ts`, `tests/command-facade.test.ts`)
- root `CONTEXT.md` (existence verified)

## Skipped Owner Paths

- `runtime/cli-command-facade/src/*.ts` contents: existence verified, line-by-line behavior not audited because v0 audits instruction contradictions only; load before accepting any finding that depends on exact facade runtime behavior.
- `https://clig.dev/` and other external URLs: out of scope; external sources are not local source evidence.

## Pass Ledger

- Pass 1 (2026-06-10): audited `create-cli/SKILL.md` against owner paths for authority, scope, lifecycle, and safety contradictions. Read SKILL.md + 4 references + runbook; verified ADR, facade package, and root CONTEXT.md exist. Examined and rejected two candidates (CONTEXT.md vocabulary split; design-vs-implementation boundary). Lifecycle N/A (no loop/finding state in this skill). Accepted contradictions: 0. One sub-threshold item parked as UQ-1. Baseline pass.
- Pass 2 (2026-06-10): fresh re-audit of all four shapes; resolved UQ-1 against `behavior-regression-checklist.md` (the behavior owner), which routes a prompt naming `@side-quest/cli-command-facade` to Facade-backed and a bare Bun-TS prompt to the ambiguous router — confirming "package named" satisfies "explicitly requested," so lane-3 classification and the Lane Depth gate agree. Accepted contradictions: 0 new. UQ-1 closed as not-a-contradiction. Convergence reached: a fresh pass added zero new accepted contradictions.

## Open Findings

- None.

## Finding History

- REJ-1 (`context-vocab-split`), status: rejected (out of scope — not a contradiction). `agent-native-cli-design.md:59,141` point vocabulary at root `../../../CONTEXT.md`; `cli-command-facade.md:30` points "Package vocabulary" at `runtime/cli-command-facade/CONTEXT.md`. These are two distinct, correctly-scoped vocabularies (skill design terms vs facade package terms), reinforced by `agent-native-cli-design.md:60` "Private implementation detail stays out of create-cli prose." Neither file claims the other's contract. No authority conflict; no repair candidate.
- REJ-2 (`design-vs-implementation-boundary`), status: rejected (not a contradiction — correctly conditioned). SKILL.md Notes (105-106) "if the request is design-only, do not drift into implementation"; references carry implementation-shape guidance gated by `agent-native-cli-design.md:63-64` "Use when planning or building." Different request conditions (design-only vs building); both followable simultaneously. No scope conflict.
- UQ-1 (`facade-lane-default-vs-explicit`), status: resolved (not a contradiction). `Do This First` lane 3 (SKILL.md 22-24) lists `@side-quest/cli-command-facade` as a Facade-backed classification signal; Lane Depth (60-62) and `cli-command-facade.md:9-10` gate the facade path to "explicitly requested or facade-owned surface." Resolution: `behavior-regression-checklist.md` (behavior owner) routes the `...using @side-quest/cli-command-facade` prompt to Facade-backed and the bare Bun-TS prompt to the ambiguous router — so naming the package *is* the explicit request. The classifier and the gate agree; both followable. No repair candidate; no source edit warranted.

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

- `docs/brainstorms/2026-06-10-skill-self-audit-loop-requirements.md`
- `skills/create-cli/references/cli-guidelines.md` (clig.dev condensed)

## Next Safe Action

- Converged at pass 2; no further passes needed. Reopen only if `create-cli/SKILL.md` or a named owner path changes. No repair candidates — `skills/create-skill/SKILL.md` has nothing to patch from this loop.
