---
date: 2026-06-15
topic: deterministic-cli-branch-confidence
type: requirements
---

# Deterministic CLI Branch Confidence

## Summary

Build a durable CLI confidence pattern where every facade-backed CLI can declare, test, and audit its expected command branches through deterministic station maps.

The pattern starts with planning-stage station sets, package-owned branch catalogs, shared process-boundary helpers, package-local integration matrices, and auditor reconciliation. Later work can add runtime receipts, trace discovery, property probes, branch coverage, workbench reports, and earned enforcement gates.

---

## Problem Frame

The repo already has strong pieces of CLI confidence, but they stop at different boundaries.

`scripts/command-entrypoint.integration.test.ts` proves real `wt`, `agent-worktree`, and `awt` entrypoints through process boundaries. `skills/skill-feedback/src/skill-feedback.test.ts` repeats process capture, JSON parsing, and failure annotation patterns. `skills/cli-execution-auditor/src/audit-engine.ts` already detects facade-backed CLIs, canonicalizes invocations, runs static checks, runs subprocess surface checks, and emits deterministic findings.

The missing object is a package-owned branch oracle. Command contracts say what commands and flags exist; tests prove selected behavior; the auditor checks lane-level execution rules. None of those surfaces say which package-owned success, failure, diagnostic, observability, continuation, and repair branches are meant to exist.

The product outcome is not "all possible code branches are tested." The outcome is declared branch coverage: every branch station the package says matters is covered, skipped with rationale, declared unreachable with rationale, drifted, or missing as a deterministic finding.

---

## Key Decisions

- **Planning declares the first station set:** A requirements or plan artifact names initial branch station ids before implementation writes a package catalog. This gives implementers a target instead of letting test-writing momentum invent the matrix.
- **Package catalogs own branch meaning:** Shared runtime code can validate generic station shape, but package vocabularies such as `protected_branch`, `invalid_closeout_receipt`, and `read_target_resolution_failed` stay with the package that emits them.
- **The auditor reconciles, it does not own intent:** `cli-execution-auditor` is the deterministic station-map and findings owner. It compares declared stations, discovery, and evidence; it does not define package semantics.
- **Shared process helpers are earned now:** `scripts/command-entrypoint.integration.test.ts` and `skills/skill-feedback/src/skill-feedback.test.ts` already repeat enough subprocess mechanics to justify extraction into `@side-quest/cli-command-facade/testing`.
- **V1 pilots on `skill-feedback`:** `skill-feedback` has write, stdin, read, health, review, retention, and failure branches without the full git-worktree setup complexity of `wt` and `agent-worktree`.
- **Gates are earned by real catches:** Station-map checks stay opt-in until the pattern catches distinct real misses across multiple CLIs. Mandatory gates before proof would create ceremony people route around.

---

## Actors

- A1. CLI package author or planning agent
  - **Goal:** Declare intended command branches before implementation fills them in.
- A2. CLI implementation agent
  - **Goal:** Build runner behavior and integration rows against declared stations.
- A3. Package-local integration suite
  - **Goal:** Observe station evidence through real process entrypoints.
- A4. CLI execution auditor
  - **Goal:** Emit station maps and deterministic findings for missing, drifted, skipped, and unreachable stations.
- A5. Maintainer or reviewer
  - **Goal:** Inspect coverage confidence without reading every test or asking an LLM to rediscover branches.

---

## Requirements

**Planning-Stage Station Sets**

- R1. Requirements or plan artifacts for new or expanded facade-backed CLIs name initial branch station ids per public command before implementation writes a package catalog.
- R2. Each planning-stage station id uses package-owned vocabulary and stays stable enough for tests, catalogs, and findings to reference.
- R3. Planning-stage station sets classify each station as `required`, `skipped`, or `declared-unreachable`.
- R4. Planning-stage station sets state declared branch coverage as the completeness claim, not whole-program branch completeness.
- R5. Planning-stage station sets include enough success, usage-failure, runtime-failure, diagnostic, repair, continuation, or observability stations that planning does not invent behavior later.

**Package-Owned Branch Catalogs**

- R6. Each package branch catalog lives near the package command contract and validates against live public command ids.
- R7. Branch catalogs preserve package-owned result vocabulary instead of moving semantic branch names into the shared facade.
- R8. Branch catalogs describe trigger shape, expected result class, exit class, envelope status, stable error or action ids when safe, diagnostic expectations, and coverage classification.
- R9. Branch catalogs can record `skipped` and `declared-unreachable` stations with rationale.
- R10. Catalog validation flags unknown command ids, duplicate station ids, unsafe projected text, and required stations with no coverage evidence.

**Process-Boundary Test Harness**

- R11. Shared process helpers capture command label, argv, cwd, stdout, stderr, exit code, timeout state, and compact failure annotations.
- R12. Shared process helpers parse JSON envelopes and annotate parse failures with process context.
- R13. Shared process helpers stay package-agnostic; repo seeding, git setup, domain fixtures, and package assertions remain in owner-local tests.
- R14. Package-local integration suites derive station rows from package catalogs rather than copying a parallel matrix by hand.
- R15. Root command-entrypoint integration stays a cross-entrypoint sentinel, not the permanent owner for every package behavior row.

**Station Maps And Auditor Reconciliation**

- R16. A station map projects facade command discovery plus package branch catalogs into deterministic JSON.
- R17. Station maps sort commands and stations canonically and omit volatile local paths, timestamps, and durations from findings.
- R18. The auditor reports missing, drifted, skipped, and declared-unreachable stations through its existing findings model.
- R19. The auditor reports a target with no branch catalog as a clear no-catalog state, not a crash.
- R20. The auditor keeps existing facade-lane clauses and fixture behavior intact while adding station-map reporting.
- R21. Station-map findings include enough context for a maintainer to identify the owning command, station id, expected branch class, and next repair surface.

**Skill-Feedback Pilot**

- R22. `skill-feedback` is the first package-owned branch catalog pilot.
- R23. The `skill-feedback` planning-stage station seed covers `record`, `closeout`, `review`, `health`, and `purge`.
- R24. `record` includes `record.success` and `record.invalid_usage`.
- R25. `closeout` includes `closeout.success_stdin` and `closeout.invalid_receipt`.
- R26. `review` includes `review.empty_inbox` and `review.target_resolution_failed`.
- R27. `health` includes `health.populated_inbox` and `health.unsafe_inbox`.
- R28. `purge` includes `purge.preview`, `purge.execute`, and `purge.invalid_usage`.
- R29. If a pilot station proves nondeterministic during implementation, the package catalog records `skipped` or `declared-unreachable` with rationale instead of deleting the station silently.

**Adoption And Documentation**

- R30. `create-cli` guidance names planning-stage station sets and package-owned branch catalogs as the reusable path for facade-backed CLI branch confidence.
- R31. `cli-execution-auditor` guidance names station-map reporting as an optional workflow until real catches justify a gate.
- R32. Shared docs name owners and next safe actions, not copied schemas that drift from code.
- R33. Future facade-backed CLI plans can reference this requirements doc as the durable WHAT before writing HOW.

**Future Requirements**

- R34. Full `wt` and `agent-worktree` station catalogs are added after the `skill-feedback` pilot stabilizes.
- R35. Runtime station evidence can be recorded as stable receipts after in-memory evidence proves useful.
- R36. Trace-driven branch discovery can suggest undeclared branches, but declared stations remain the source of truth.
- R37. Property-based argv and input probing can explore unknown input spaces around declared station contracts.
- R38. Branch coverage instrumentation can become a secondary completeness signal, especially for hand-rolled CLIs.
- R39. Generated test source can be considered after generated data and hand-written tests prove the station model shape.
- R40. A branch workbench report can render station coverage, gaps, skipped rationale, drift, and next safe action for maintainers.
- R41. Mandatory create-cli or create-skill gates can ship only after the station-map path catches repeated real misses across distinct CLIs.
- R42. Non-facade and hand-rolled CLI support can expand after lane markers and coverage instrumentation make completeness claims honest.
- R43. Safe auto-fixes can be explored after station findings prove stable and repair classes are clearly bounded.

---

## Key Flows

- F1. Planning-stage station declaration
  - **Actors:** A1, A2
  - **Trigger:** A new or expanded facade-backed CLI is being planned.
  - **Steps:** The requirements or plan artifact names initial station ids per command, classifies each station, and states the declared-coverage limit.
  - **Outcome:** Implementation starts with a branch target instead of inventing the test matrix after runner code exists.
  - **Covers:** R1, R2, R3, R4, R5.

- F2. Package catalog scaffold
  - **Actors:** A2, A3
  - **Trigger:** Implementation starts for a planned facade-backed CLI.
  - **Steps:** The package adds a branch catalog beside the command contract, translates the planning-stage station set into code, and validates catalog ids against command discovery.
  - **Outcome:** Required stations are visible as covered, missing, skipped, or declared unreachable before process integration tests are complete.
  - **Covers:** R6, R7, R8, R9, R10.

- F3. Catalog-driven integration
  - **Actors:** A2, A3
  - **Trigger:** Package-local process tests are added or refactored.
  - **Steps:** Tests use shared process helpers, derive station rows from the package catalog, observe subprocess evidence, and fail when a required station has no row.
  - **Outcome:** The package has process-boundary confidence without centralizing every behavior row in the root suite.
  - **Covers:** R11, R12, R13, R14, R15.

- F4. Auditor station-map reconciliation
  - **Actors:** A4, A5
  - **Trigger:** A maintainer or agent audits a facade-backed CLI.
  - **Steps:** The auditor reads discovery and the package catalog, emits canonical station-map JSON, and records findings for missing or drifted required stations.
  - **Outcome:** A maintainer can see which branch stations are proven, missing, skipped, unreachable, or drifted.
  - **Covers:** R16, R17, R18, R19, R20, R21.

- F5. Earned gate promotion
  - **Actors:** A4, A5
  - **Trigger:** Station-map checks catch repeated real misses across distinct CLIs.
  - **Steps:** The team promotes the opt-in station-map workflow into an explicit gate with recorded override semantics.
  - **Outcome:** Enforcement follows evidence instead of arriving as speculative process.
  - **Covers:** R31, R41, R42.

---

## Acceptance Examples

- AE1. Planning names branch stations before implementation
  - **Covers:** R1, R2, R3, R4, R5.
  - **Given:** A plan adds a new facade-backed CLI command.
  - **When:** The plan is ready for implementation.
  - **Then:** The plan names initial station ids for the command and marks each as required, skipped, or declared unreachable.

- AE2. Catalog preserves the planning seed
  - **Covers:** R6, R10, R22, R23, R29.
  - **Given:** The `skill-feedback` pilot implements a package branch catalog.
  - **When:** The catalog is validated.
  - **Then:** Every planning-stage station seed appears in the catalog unless it has a skip or unreachable rationale.

- AE3. Required missing station becomes a finding
  - **Covers:** R10, R16, R18, R21.
  - **Given:** A branch catalog marks `closeout.invalid_receipt` as required.
  - **When:** No integration evidence covers that station.
  - **Then:** The station map reports it as missing through an auditor finding.

- AE4. Nondeterministic branch stays visible
  - **Covers:** R3, R9, R29.
  - **Given:** Implementation discovers a planned station depends on brittle host state.
  - **When:** The station cannot be tested deterministically.
  - **Then:** The package catalog records `skipped` or `declared-unreachable` with rationale instead of removing it.

- AE5. No whole-program coverage claim
  - **Covers:** R4, R16, R17.
  - **Given:** A station map reports every declared `skill-feedback` station as covered.
  - **When:** The auditor emits its summary.
  - **Then:** The summary claims declared branch coverage only and does not claim all TypeScript branches are covered.

- AE6. Future gate waits for evidence
  - **Covers:** R31, R41.
  - **Given:** The station-map workflow has only one pilot.
  - **When:** A create-cli or create-skill workflow runs.
  - **Then:** Station-map checks remain optional until repeated real misses justify promotion.

---

## Scope Boundaries

### In Scope For The First Implementation Plan

- Shared CLI process-boundary test helpers.
- `skill-feedback` planning-stage station seed and package-owned branch catalog.
- `skill-feedback` package-local integration tests derived from the catalog.
- Owner-local integration tests for `wt` and `agent-worktree`.
- Generic station-map model and projection helpers.
- `cli-execution-auditor` station-map JSON and station findings.
- Documentation that makes the pattern reusable for future facade-backed CLIs.

### Deferred For Later

- Full station catalogs for `wt` and `agent-worktree`.
- Durable station receipt files written by tests.
- Trace-driven suggestions for undeclared branches.
- Property-based argv and input probing.
- Branch coverage instrumentation with c8 or Istanbul.
- Generated test source from station maps.
- HTML branch workbench reports.
- Mandatory create-cli or create-skill enforcement gates.
- Persisted per-CLI lane markers.
- Hand-rolled CLI station-map support beyond static best-effort checks.
- Safe auto-fixes for stable station findings.
- `wt open <name>` GUI-launch integration coverage.
- Post-mutation partial failure fault injection for `agent-worktree`.

### Outside This Product Identity

- LLM reviewer loops as the primary branch-confidence mechanism.
- Whole-output stdout or stderr snapshots as the main assertion strategy.
- A standalone station-map tool detached from `cli-execution-auditor`.
- A full static TypeScript branch enumerator as the source of semantic branch intent.
- Moving package-specific branch vocabulary into facade core.

---

## Dependencies And Assumptions

- The first planning consumer is `docs/plans/2026-06-15-002-feat-cli-branch-station-maps-plan.md`.
- The current facade testing subpath exists at `runtime/cli-command-facade/src/testing.ts`.
- The current facade package exports `@side-quest/cli-command-facade/testing`.
- The current auditor already owns deterministic lane detection, subprocess surface checks, and findings in `skills/cli-execution-auditor/src/audit-engine.ts`.
- The `skill-feedback` public command set is `record`, `closeout`, `review`, `health`, and `purge`.

---

## Sources And Research

- `docs/ideation/2026-06-15-deterministic-cli-branch-confidence-ideation.html`
- `docs/plans/2026-06-15-002-feat-cli-branch-station-maps-plan.md`
- `docs/brainstorms/2026-06-14-command-entrypoint-integration-tests-requirements.md`
- `docs/brainstorms/2026-06-10-cli-execution-experience-auditor-requirements.md`
- `runtime/cli-command-facade/package.json`
- `runtime/cli-command-facade/src/testing.ts`
- `skills/cli-execution-auditor/src/audit-engine.ts`
- `skills/skill-feedback/src/command-contract.ts`
- `scripts/command-entrypoint.integration.test.ts`
- `skills/skill-feedback/src/skill-feedback.test.ts`
