---
title: CLI Execution-Experience Auditor — Requirements
date: 2026-06-10
status: active
type: requirements
scope: Deep — feature
owner: Nathan Vale
---

# CLI Execution-Experience Auditor

## Problem

CLIs ship with broken branches that only surface under specific argument permutations:
wrong exit codes, unactionable errors, `--json` that breaks under failure, raw-runner-rule
violations, silent coverage gaps. Tonight's `heal-skill` rebuild found three such bugs by
hand (raw `bun test`, owner-paths matching zero paths, single-suite coverage) — and only
caught them because a human probed 15 angles ad hoc.

The obvious fix — a loop of adversarial reviewer agents that converges when "nobody finds
anything new" — was attacked by 5 independent reviewers and found **WOUNDED** on every axis.
Community research confirmed why: a same-model judge panel loses ~75% of its independence to
correlated errors ("Nine Judges, Two Effective Votes", arxiv 2605.29800), and silence-based
convergence *rewards symptom-masking* ("LLM-as-judge is a second failure mode"). Zero-new is a
claim about the judges, not the CLI.

The breakthrough is **the per-lane contract**, not enumeration. The value is a deterministic
contract that says what correct execution looks like (exit codes, stdout/stderr discipline,
`--json` envelope shape, repair hints) — pass/fail is a fact, not a vote. Enumeration is how you
*exercise* that contract across a CLI's surface; the contract is what *catches* the bug.

This matters because of a verified codebase fact: the facade-backed CLIs here expose a declarative
discovery surface (typed flags, side-effects, exec modes) that is genuinely enumerable. The
hand-rolled `process.argv` CLIs do not — their flag namespace is unbounded by construction, so
"enumerate from the parser" has no static target. **v1 scopes to the facade lane**, where the
contract IS the oracle; hand-rolled lanes are best-effort with completeness explicitly unproven
until branch-coverage instrumentation lands.

Honest caveat on the motivating bugs: of the three heal-skill bugs, only some are flag-permutation
defects. The raw-`bun test` violation and owner-paths-zero-match are *static contract* properties,
not execution-experience facts of a flag combination. The auditor catches them via **static contract
assertions per lane**, not by enumerating permutations — so the contract, not enumeration, is doing
the work. The success criterion below tests this directly.

## Outcome

A skill that deterministically audits a CLI's agent-execution experience against a per-lane
contract — exercise the surface, check each invocation's execution against the lane contract.

**v1: opt-in tool, facade lane.** The auditor exists and is invoked manually during create-cli
work. It targets facade-backed CLIs (the lane with a real enumerable surface) and reproduces the
known heal-skill bugs via static contract assertions + facade-surface enumeration.

**v2: earn the gate.** Promote to a mandatory create-cli / create-skill gate only after N≥3
distinct real-bug catches across different CLIs. The gate, when it lands, has a logged override
(`--audit-override="<reason>"` recorded as accepted risk) — a mandatory gate with no escape hatch
on a captive single-maintainer toolchain gets silently routed around, which is worse than a soft gate.

The auditor's own output honors the agent-native contract it can check (structured envelope,
repair hints, run correlation). Full facade-backed dogfooding is a v2 nicety, not a v1 gate.

## Requirements

### Core behavior

- Two check kinds per CLI: **static contract assertions** (lane properties checkable without
  enumerating — e.g. no raw-runner call, help exists, exit-code conventions) and **surface
  exercise** (run each enumerable invocation and check its execution against the lane contract).
- v1 enumeration source is the **facade discovery surface** (typed flags, subcommands, exec modes).
  Hand-rolled CLIs get static assertions only; their surface completeness is unproven until coverage.
- Each check has a deterministic expected outcome derived from the lane contract; pass/fail is a fact.

### Lane-aware contract

- **Facade-backed CLI (v1 target)**: full `@side-quest/cli-command-facade` contract — discovery
  metadata, rendered help, argv acceptance/rejection, structured envelope, repair hints, run
  correlation, runtime-semantics-cannot-drift. Owner: `runtime/cli-command-facade/AGENTS.md` —
  checked by reference, not copied.
- **Agent-native / Basic CLI (v1 best-effort, v2 full)**: floor of help-works, sane exit codes,
  stdout/stderr discipline, no-crash-on-bad-input, plus envelope/repair-hints/run-id for agent-native.
- **Lane detection** is an outstanding question — no per-CLI lane marker exists today. v1 detects
  facade lane mechanically (imports `@side-quest/cli-command-facade`); everything else defaults to
  the Basic floor unless a lane marker is added. Persisting a lane marker is a v2 gate prerequisite.

### Findings model

Reuse `skills/skill-self-audit-loop/`'s findings pattern by reference — ledger states
(open/resolved/rejected/duplicate), dedupe-by-signature, never-delete history, Candidate Shapes
promotion. The auditor owns *writes to its own findings ledger* (a separate artifact); "read-only"
means it never edits CLI source. Repair is handed off to the normal code-fix path.

Deltas this skill adds (propose upstream to skill-self-audit-loop if they generalize):

- **Falsifiable resolution criterion** per finding: the re-check is *generated from the lane
  contract clause*, not authored free-text from the observed symptom — so a masking-fix (swallow
  the error) cannot write itself a symptom-level re-check that it then passes. Verifiable close =
  re-run the failing invocation, assert the contract clause holds.
- Signatures anchor to semantic intent (the contract clause + invocation), not code coordinates.

### Output (dogfooding — bounded)

- The auditor's own CLI honors the **agent-native** contract it can check: structured envelope,
  repair hints, run correlation, quiet success / rich failure, human + `--json` modes.
- Dogfooding proves *output conformance*, not *checker correctness* — so checker correctness is
  proven by a fixture corpus (see Success criteria), never by self-audit alone.

### Enforcement gate (v2 — earned, not v1)

- Not in v1. Promote to a `create-cli` / `create-skill` gate only after N≥3 distinct real-bug
  catches across different CLIs prove the floor's value and false-positive rate.
- When it lands: a named check with a **logged override** (`--audit-override="<reason>"` recorded
  in the findings ledger as accepted risk, visible in review). Mandatory-with-recorded-escape, not
  mandatory-with-silent-bypass.
- Prerequisite: a persisted per-CLI lane marker (does not exist today).

## Success criteria

- **Checker-correctness (the real oracle):** a fixture corpus of known-bad CLIs (one per contract
  clause) that the auditor MUST flag, and known-good CLIs it MUST pass. Self-dogfooding never
  substitutes for this.
- **Known-answer replay:** running the auditor reproduces the heal-skill bugs — with each bug
  pre-classified as static-assertion-caught vs surface-exercise-caught, so the contract-vs-enumeration
  split is tested, not assumed.
- **Unseen-CLI catch:** run on an existing shipped facade CLI *not* used to design the auditor;
  surface ≥1 previously-unknown finding or cleanly pass. The v2 gate is gated on this, not on the replay.
- A facade CLI that passes has no unexercised **statically-enumerable** branch (honest about the limit).
- A masking-fix does NOT close its finding — the contract-derived re-check still fails.

## Scope boundaries

### In scope (v1)
- Facade-backed CLIs (the lane with a real enumerable discovery surface).
- Per-lane contract checks: static assertions + facade-surface exercise.
- The auditor as an opt-in tool invoked during create-cli work.

### Deferred for later
- The mandatory enforcement gate (v2, at N≥3) and its lane-marker prerequisite.
- Full coverage of Basic / Agent-native hand-rolled CLIs (best-effort static-only until coverage).
- Branch-coverage *instrumentation* (c8/Istanbul) as the completeness oracle for hand-rolled lanes.
- Full facade-backed dogfooding of the auditor; auto-fixing safe finding classes.

### Outside this skill's identity
- Open-ended source code review (ce-code-review's job; this audits *runtime CLI behavior*).
- A convergence loop of adversarial judge agents — explicitly rejected; see Decision Record.
- General fuzzing of non-CLI code.

## Decision record

- **Contract-checking is the oracle; enumeration exercises it.** Rejected the 5-reviewer
  convergence loop (5/5 WOUNDED: correlated blind spots, masking-reward; literature confirms
  same-model panels collapse to ~2 effective votes). The genuine advantage is the *deterministic
  per-lane contract* — pass/fail is a fact. **Caveat made explicit:** contract-checking is
  deterministic everywhere; *enumeration completeness* is deterministic only for facade CLIs.
  For hand-rolled CLIs, enumeration is LLM-assisted and unproven until coverage lands — so v1
  scopes to facade to avoid re-importing the rejected loop's blind-spot problem under a new name.
- **v1 tool, v2 gate.** N≈1 evidence cannot bootstrap mandatory infrastructure by mandating its
  own future use. Build the tool opt-in; earn the gate with real recurrence (N≥3).
- **Checker correctness via fixtures, not self-dogfood.** A buggy checker self-certifies; only a
  known-bad/known-good corpus is ground truth.
- **Reuse skill-self-audit-loop's findings pattern by reference.** Ledger, dedupe, Candidate Shapes,
  proof methods (`skills/skill-self-audit-loop/references/loop-proof-methods.md`). The only delta is
  contract-derived falsifiable re-checks; propose upstream if it generalizes.

## Dependencies / assumptions

- Depends on the facade contract owner (`runtime/cli-command-facade/`) and create-cli lane
  definitions (`skills/create-cli/references/`).
- Reuses `skills/skill-self-audit-loop/` findings ledger + proof-method patterns by reference
  (verified: that catalog is written for cross-skill reuse — no ownership conflict).
- Verified codebase facts: ~29 facade CLIs (enumerable) vs ~30 hand-rolled `process.argv` CLIs
  (unbounded flag namespace, not statically enumerable); no per-CLI lane marker exists; the
  heal-skill *skill* has no CLI of its own (the oracle target needs restating — see questions).
- N-evidence: N≈1. The tool is justified opt-in; the gate is not justified until N≥3.

## Oracle decision (resolved 2026-06-10)

The v1 oracle is **`skills/classic-cinema/src/heal-skill.ts`, rebuilt facade-backed.** It already
has `check/repair/explain` + `--json` + `--help` (hand-rolled, agent-native lane); migrating it to
`@side-quest/cli-command-facade` gives it a declarative enumerable surface — the clean facade-lane
target v1 needs. This supersedes the SKILL.md-only `skills/heal-skill/` (whose defects are
skill-workflow issues, not CLI behavior). Build the facade CLI first (via create-cli), then the
auditor audits it.

## Outstanding questions
- Where does the v2 gate wire in (create-skill verification, create-cli proof, or both), and how is
  the lane marker persisted?
- How does facade-surface enumeration handle interdependent flags (flag A only valid with subcommand B)?
- Who/what generates the contract-derived re-check, and is it provably non-symptom-level?

## Provenance

Emerged from a single session (2026-06-10): heal-skill v2 rebuild → 15 manual probes → convergence-loop
prototype → 5-reviewer adversarial design attack (5/5 WOUNDED) → community research (LLM-as-judge
correlated-failure literature) → reframe to deterministic per-lane contract. Then a 5-persona
ce-doc-review of this requirements doc → scoped v1 to facade lane, decoupled tool from gate,
reframed premise around the contract, added the fixture-corpus oracle.
