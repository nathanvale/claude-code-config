---
date: 2026-06-14
topic: agent-runner-gold-standard
---

# Agent Runner Gold Standard Requirements

## Summary

Codify `test-runner` as the explicit, enforced **Agent Runner gold standard** — a written runner contract, `cli-execution-auditor` enforcement of that contract for any runner, and a scaffold that emits conformant runner skeletons — then convert **one** MCP-only check (Biome format-runner or tsc typescript-runner) against the standard as living proof it is conversion-ready.

This is the "separate evidence" successor the `docs/brainstorms/2026-06-05-production-agent-test-runner-convergence-requirements.md` brainstorm explicitly deferred (its R35 and non-goal "do not claim Biome or TypeScript MCP replacement... until separate evidence exists"). It is also the first move of the larger direction explored in `docs/ideation/2026-06-14-task-doctor-ideation.html`: a uniform agent-native runner family is the prerequisite for the generated Command Surface Map and Task Doctor, both of which stay out of scope here.

---

## Problem Frame

`test-runner` already has the proven shape of a production Agent Runner — `run`/`status`/`detail` subcommands, compact/repair/triage/json modes, a `command-contract.ts`, a benchmark, and `cli-execution-auditor` proof. But that shape lives only as one worked implementation. There is no written contract a new runner must conform to, no mechanical check that a new runner matches the standard, and no scaffold to start from. "Clone test-runner" is tribal knowledge.

That gap blocks everything downstream. The check owners in this repo are ragged: `test-runner`/`fallow`/`skill-feedback` are facade CLIs, but Biome and tsc are MCP-only (`biome_lintCheck`, `tsc_check`), and `rules/code-quality.md` hard-rules agents into the MCP path for them. Until every check is a uniform agent-native runner, the Command Surface Map has nothing consistent to aggregate and Task Doctor has ragged owners to special-case.

The bet: codify the standard first, prove it converts one real runner, and the rest of the family — plus the Map and the doctor — follows on a proven foundation rather than tribal imitation.

---

## Key Decisions

- **test-runner is the gold standard, codified — not just an exemplar.** The standard is three reinforcing layers: a written contract, auditor enforcement, and a clonable scaffold. "Read test-runner and match it" is explicitly rejected as insufficient for a real second runner.
- **Gold standard before conversion.** The contract, auditor enforcement, and scaffold are established using test-runner as the worked example before any new runner is built. A conversion against an uncodified standard would re-derive the shape by imitation, which is the gap this closes.
- **One conversion is the proof.** A standard with zero conversions is unproven. The first deliverable includes converting one runner (Biome or tsc) against the standard. It stops there — the second runner is a named follow-on.
- **Preflight first: evaluate and collate before codifying.** Before extracting the contract, smoke-test the current test-runner and gather all scattered prior runner documentation, plans, and ideation into a `skills/test-runner/docs/` folder. The contract is grounded in what test-runner actually does and what prior thinking already settled, not composed from memory.
- **The auditor enforces the standard mechanically.** `cli-execution-auditor` validates any runner against the gold-standard shape, so the standard is a check, not prose that drifts.
- **MCP guidance retires in lockstep with each conversion.** When a runner is converted, `rules/code-quality.md` and `context/bun-runner.md` are updated in the same move to retire that runner's MCP-only guidance. The two guidance sources never contradict the runtime.
- **Advisor-not-orchestrator stays the settled constraint** for the eventual Task Doctor. Recorded here so the downstream doctor brainstorm inherits it rather than re-litigating.
- **Map and doctor are out of scope.** This brainstorm establishes the runner family foundation only. The generated Command Surface Map, per-owner applies-when predicates, and Task Doctor are named follow-ons.

---

## Actors

- A1. **Implementation agent:** Finishes a change and needs to run lint / format / type checks through a uniform agent-native runner instead of an MCP tool.
- A2. **Runner author:** Builds a new runner (or converts an MCP-only check) and needs a contract to conform to and a scaffold to start from.
- A3. **Maintainer:** Reviews conversion evidence, auditor results, and the retirement of MCP-only guidance.
- A4. **cli-execution-auditor:** Validates any runner against the gold-standard contract and fails non-conformant ones.
- A5. **test-runner:** The worked exemplar the contract is extracted from and the first conformance subject.

---

## Requirements

### Preflight — evaluate and collate

- R1. Smoke-test the current `test-runner` and record what each subcommand and mode actually produces, so the contract is grounded in observed behavior.
- R2. Gather all prior runner material into a new `skills/test-runner/docs/` folder: the three runner brainstorms (`2026-06-04-test-runner-compact-runner`, `2026-06-05-agent-runner-context-escalation`, `2026-06-05-production-agent-test-runner-convergence`), the two plans (`2026-06-04-003-feat-test-runner-compact-runner`, `2026-06-05-001-feat-agent-runner-context-escalation`), the ideation (`2026-06-04-test-runner-compact-runner`), the decision log (`2026-06-04-test-runner-compact-runner-decision-log`), and `context/bun-runner.md` as the family-guidance pointer. Collate, do not duplicate — link or summarize so the folder is the single entry point to test-runner's history.
- R3. The collation names the deferral thread it picks up: the prior convergence brainstorm's "Biome and TypeScript stay separate until separate evidence exists."

### Gold standard — contract

- R4. A written Agent Runner contract exists, extracted from test-runner, naming the required surface: subcommands (`run`/`status`/`detail` and their roles), modes (compact/repair/triage/json), the result envelope shape, exit-code semantics, and proof obligations (a benchmark and an auditor pass).
- R5. The contract names owners, not copies them: it points at `skills/create-cli/references/cli-command-facade.md` and `agent-native-cli-design.md` for the facade four-surface proof rather than restating those rules.
- R6. test-runner provably conforms to the contract — the contract is validated against its own exemplar before any conversion.

### Gold standard — auditor enforcement

- R7. `cli-execution-auditor` validates any runner against the gold-standard contract, not only bespoke per-runner checks.
- R8. The auditor fails a non-conformant runner (missing a required subcommand, mode, envelope field, or proof obligation) and passes a conformant one.

### Gold standard — scaffold

- R9. A scaffold or template emits a conformant runner skeleton, so a new runner starts from the standard rather than hand-copying test-runner files.
- R10. A runner produced from the scaffold passes the auditor with no manual contract-conformance work.

### First conversion — proof

- R11. One MCP-only check (Biome format-runner OR tsc typescript-runner) is converted into an agent-native runner conforming to the contract, auditor-green.
- R12. The converted runner replaces the MCP-only path for its check (the agent runs it as a CLI, not via the MCP tool).
- R13. `rules/code-quality.md` and `context/bun-runner.md` are updated in the same move to retire the converted runner's MCP-only guidance, with no contradiction left between guidance and runtime.

### Constraint carried forward

- R14. The decision "Task Doctor is an advisor (reduces over owner declarations), never an orchestrator (derives and runs routes)" is recorded so the downstream doctor work inherits it.

---

## Scope Boundaries

### In scope

- Preflight smoke-test + collation of prior runner material into `skills/test-runner/docs/`.
- The written runner contract, extracted from test-runner.
- `cli-execution-auditor` enforcement of that contract.
- A scaffold that emits conformant runner skeletons.
- Converting **one** runner (Biome or tsc) against the standard.
- Retiring that one runner's MCP-only guidance in `rules/code-quality.md` and `context/bun-runner.md`.

### Deferred for later (named, not abandoned)

- The **second** runner conversion (whichever of Biome / tsc is not done first).
- The generated **Command Surface Map** aggregating runner contracts.
- The per-owner **applies-when predicate** field every owner declares.
- **Task Doctor** — the thin advisor that reduces over the Map to emit the next-safe-check route.
- Promoting tier-C owners (create-cli facade proof, startup health) into the predicate scheme.

### Outside this product's identity

- Task Doctor deriving and running checks (orchestrator). Advisor-only is settled (R14).
- Hand-edited Map rows the runner contracts do not back (a second source of truth).
- Replacing native tool output as the truth source — the prior convergence decision ("native output remains the truth source") still holds for every runner.

---

## Success Criteria

- The runner contract exists and test-runner provably conforms to it (R4, R6).
- `cli-execution-auditor` fails a deliberately non-conformant runner and passes a conformant one (R8).
- A scaffold-produced skeleton passes the auditor with no manual conformance work (R10).
- One real runner (Biome or tsc) is converted, agent-native, auditor-green, and its MCP-only path is retired in both guidance files (R11–R13).
- `skills/test-runner/docs/` is the single entry point to test-runner's prior history (R2).
- The advisor-not-orchestrator constraint is recorded for the downstream doctor (R14).

---

## Dependencies / Assumptions

- **Assumption:** the test-runner shape is genuinely conversion-ready — the preflight smoke-test (R1) validates this; if test-runner has implicit behavior that resists extraction into a contract, the contract scope grows and the assumption is revisited.
- **Dependency:** `cli-execution-auditor` can be extended to validate against a shared contract rather than only bespoke checks. If its architecture resists a generic conformance mode, R7 becomes its own sub-effort.
- **Assumption:** Biome and tsc can each be wrapped in a runner that produces the contract's envelope shape from their native output. The prior convergence brainstorm proved this pattern for Bun (native output as truth source, conversion layer, fail-open on parser drift); the same shape is assumed to transfer.
- **Dependency:** `rules/code-quality.md` is a hard-rule startup surface — changing it routes through the prompt-system workflow, not a freehand edit.

---

## Outstanding Questions

- **Which runner converts first — Biome (format-runner) or tsc (typescript-runner)?** Biome covers lint+format (two MCP tools retired, broader guidance cleanup); tsc is a single check with simpler output. Resolve at planning.
- Does the scaffold live as a `create-cli` capability, a standalone template dir, or a generator script? (Implementation choice — defer to ce-plan.)
- Does the collated `skills/test-runner/docs/` move the originals or link them in place? Default assumption: link/summarize in place to avoid breaking existing cross-references; confirm at planning.

---

## Sources

- Deferral thread: `docs/brainstorms/2026-06-05-production-agent-test-runner-convergence-requirements.md` (R35; "Biome and TypeScript stay separate").
- Larger direction: `docs/ideation/2026-06-14-task-doctor-ideation.html` (ideas #1–#3; Map and doctor are follow-ons to this).
- Prior runner history (collation targets): `docs/brainstorms/2026-06-04-test-runner-compact-runner-requirements.md`, `docs/brainstorms/2026-06-05-agent-runner-context-escalation-requirements.md`, `docs/plans/2026-06-04-003-feat-test-runner-compact-runner-plan.md`, `docs/plans/2026-06-05-001-feat-agent-runner-context-escalation-plan.md`, `docs/ideation/2026-06-04-test-runner-compact-runner-ideation.md`, `docs/decisions/2026-06-04-test-runner-compact-runner-decision-log.md`.
- Contract source: `skills/create-cli/references/cli-command-facade.md`, `skills/create-cli/references/agent-native-cli-design.md`.
- Family guidance to update: `rules/code-quality.md`, `context/bun-runner.md`.
- Exemplar: `skills/test-runner/` (SKILL.md, src/command-contract.ts, src/test-runner.ts, src/test-runner.benchmark.ts).
