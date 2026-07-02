---
target_skill: skills/cli-author/SKILL.md
status: converged
passes: 4
last_pass: 2026-06-16
convergence: converged
---

# Skill Self-Audit Loop: cli-author

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
/goal Read docs/skill-audits/cli-author/self-audit-loop.md and audit the target SKILL.md for instruction contradictions. Update only the audit loop file. Stop when a fresh pass adds zero new accepted contradictions.
```

Full path:

```text
/goal Resume the skill self-audit loop from docs/skill-audits/cli-author/self-audit-loop.md. Read the loop file first, then the target SKILL.md, then the owner paths named there. Audit only authority, scope, lifecycle, and safety contradictions. Update only the audit loop file. Do not edit skill source. Continue fresh passes until one pass adds zero new accepted contradictions, or mark blocked when evidence, authority, loop state, privacy, or a human decision prevents honest convergence.
```

One-pass fallback:

```text
/loop Read docs/skill-audits/cli-author/self-audit-loop.md first. Run the next numbered audit pass only. Update only the audit loop file. Stop after recording the pass result, next safe action, and file status.
```

## Target

- Skill: `cli-author`
- Target path: `skills/cli-author/SKILL.md`
- Audit file: `docs/skill-audits/cli-author/self-audit-loop.md`

## Scope

- Audit one target `SKILL.md`.
- Audit instruction contradictions only.
- Do not edit target skill source.
- Do not audit every skill in the repo.
- Do not run `/goal` or `/loop` from the loop-creation skill.

## Loaded Owner Paths

- `skills/create-skill/references/skill-design-decision-runbook.md`
- `skills/context-advisor/references/storage-routing.md`
- `skills/cli-author/SKILL.md`
- `skills/cli-author/references/cli-guidelines.md`
- `skills/cli-author/references/agent-native-cli-design.md`
- `skills/cli-author/references/cli-command-facade.md`
- `skills/cli-author/references/behavior-regression-checklist.md`
- `CONTEXT.md`
- `docs/adr/0009-cli-author-uses-bounded-local-extension.md`

## Skipped Owner Paths

- `runtime/cli-command-facade/AGENTS.md`, `runtime/cli-command-facade/CONTEXT.md`, `runtime/cli-command-facade/src/index.ts`, `runtime/cli-command-facade/src/command-facade.ts`, `runtime/cli-command-facade/src/command-contract.ts`, `runtime/cli-command-facade/src/command-metadata.ts`, `runtime/cli-command-facade/src/command-discovery.ts`, `runtime/cli-command-facade/src/usage.ts`, `runtime/cli-command-facade/src/cli-writer.ts`, `runtime/cli-command-facade/src/runtime-envelope.ts`, `runtime/cli-command-facade/src/runtime-text-safety.ts`, `runtime/cli-command-facade/src/station-map.ts`, `runtime/cli-command-facade/src/cli-diagnostics.ts`, `runtime/cli-command-facade/src/testing.ts`, and `runtime/cli-command-facade/tests/command-facade.test.ts`: named by `skills/cli-author/references/cli-command-facade.md`; not loaded in passes 3-4 because exact facade runtime behavior is out of scope until a pass proposes a finding that depends on it.
- `skills/cli-execution-auditor/src/station-map.ts`: named by `skills/cli-author/references/cli-command-facade.md`; not loaded for setup refresh because cross-package Station Map reporting is out of scope until a pass proposes a finding that depends on it.
- `https://clig.dev/` and other external URLs: out of scope; external sources are not local source evidence.

## Pass Ledger

- Setup refresh (2026-06-16): not an audit pass. Reopened loop state because `skills/cli-author/references/agent-native-cli-design.md` and `skills/cli-author/references/cli-command-facade.md` changed after the prior convergence. Refreshed loaded and skipped owner paths. Preserved prior findings and history.
- Pass 4 (2026-06-16): user-requested rerun after pass 3 convergence. Re-read loop workflow, this audit file, `skills/create-skill/references/skill-design-decision-runbook.md`, `skills/cli-author/SKILL.md`, storage routing, four `cli-author` references, `CONTEXT.md`, and ADR 0009. Ran default owner-path check; it returned `status: ok` with `files: []` because the relevant skill reference edits were staged. Re-ran explicit owner-path check over `skills/cli-author/references/agent-native-cli-design.md` and `skills/cli-author/references/cli-command-facade.md`; result `status: ok`, no diagnostics. Audited authority, scope, lifecycle, and safety contradictions. Accepted contradictions: 0 new. No new candidate shapes, unresolved questions, dedupe warnings, or repair candidates. Convergence remains valid: a fresh pass added zero new accepted contradictions.
- Pass 3 (2026-06-16): fresh re-audit after setup refresh. Read `skills/cli-author/SKILL.md`, runbook, storage routing, four `cli-author` references, `CONTEXT.md`, and ADR 0009. Ran `bun run skills/create-skill/scripts/check-owner-paths.ts --json`; result `status: ok` for changed `cli-author` references. Audited authority, scope, lifecycle, and safety contradictions. Accepted contradictions: 0 new. Agent-native and Facade-backed guidance remain followable together because `SKILL.md` routes Facade-backed through both references, `agent-native-cli-design.md` says facade-backed is an enforcement path for the agent-native goal, and `cli-command-facade.md` says to apply Agent-native CLI design before facade runtime enforcement. Runtime-contract authority remains followable because exact runtime shape stays in runtime owner paths and prose points there instead of copying helper signatures. Safety gates remain aligned: destructive, auth, billing, externally visible, irreversible, and ambiguous side-effect cases require handoff, preview, execute mode, or confirmation. Lifecycle N/A (no loop/finding state in this skill). Convergence reached: a fresh pass added zero new accepted contradictions.
- Pass 1 (2026-06-10): audited `cli-author/SKILL.md` against owner paths for authority, scope, lifecycle, and safety contradictions. Read SKILL.md + 4 references + runbook; verified ADR, facade package, and root CONTEXT.md exist. Examined and rejected two candidates (CONTEXT.md vocabulary split; design-vs-implementation boundary). Lifecycle N/A (no loop/finding state in this skill). Accepted contradictions: 0. One sub-threshold item parked as UQ-1. Baseline pass.
- Pass 2 (2026-06-10): fresh re-audit of all four shapes; resolved UQ-1 against `behavior-regression-checklist.md` (the behavior owner), which routes a prompt naming `@side-quest/cli-command-facade` to Facade-backed and a bare Bun-TS prompt to the ambiguous router — confirming "package named" satisfies "explicitly requested," so lane-3 classification and the Lane Depth gate agree. Accepted contradictions: 0 new. UQ-1 closed as not-a-contradiction. Convergence reached: a fresh pass added zero new accepted contradictions.

## Open Findings

- None.

## Finding History

- REJ-1 (`context-vocab-split`), status: rejected (out of scope — not a contradiction). Current `agent-native-cli-design.md` points package-owned result vocabulary at root `CONTEXT.md` via `../../CONTEXT.md`; `cli-command-facade.md` points "Package vocabulary" at `runtime/cli-command-facade/CONTEXT.md`. These are two distinct, correctly-scoped vocabularies (skill design terms vs facade package terms), reinforced by `agent-native-cli-design.md` "Private implementation detail stays out of cli-author prose." Neither file claims the other's contract. No authority conflict; no repair candidate.
- REJ-2 (`design-vs-implementation-boundary`), status: rejected (not a contradiction — correctly conditioned). `SKILL.md` Notes say "if the request is design-only, do not drift into implementation"; references carry implementation-shape guidance gated by `agent-native-cli-design.md` "Use when planning or building." Different request conditions (design-only vs building); both followable simultaneously. No scope conflict.
- UQ-1 (`facade-lane-default-vs-explicit`), status: resolved (not a contradiction). `Do This First` lane 3 lists `@side-quest/cli-command-facade` as a Facade-backed classification signal; Lane Depth and `cli-command-facade.md` gate the facade path to explicit facade-backed, package-named, or facade-owned surfaces. Resolution: `behavior-regression-checklist.md` (behavior owner) routes the `...using @side-quest/cli-command-facade` prompt to Facade-backed and the bare Bun-TS prompt to the ambiguous router, so naming the package *is* the explicit request. The classifier and the gate agree; both followable. No repair candidate; no source edit warranted.

## Unresolved Questions

- None.

## Dedupe Warnings

- None.

## Candidate Shapes

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
- `skills/cli-author/references/cli-guidelines.md` (clig.dev condensed)

## Next Safe Action

- Converged at pass 4; no further passes needed. Reopen only if `skills/cli-author/SKILL.md` or a named owner path changes. No repair candidates; `skills/create-skill/SKILL.md` has nothing to patch from this loop.
