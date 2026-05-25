---
title: "feat: Add run-specific Workflow Learnings section to per-issue ledger"
status: active
created: 2026-05-25
issue: 91
target_repo: nathanvale/claude-code-config
---

# feat: Add run-specific Workflow Learnings section to per-issue ledger

**Issue:** https://github.com/nathanvale/claude-code-config/issues/91
**Parent PRD:** #88
**Shipped prereq:** #90 (registry helper)

## Problem frame

Issue #90 shipped the **canonical, cross-run** Workflow Learnings registry: the helper at `runbooks/issue-to-pr-v2/lib/learnings.ts`, the dispatcher at `runbooks/issue-to-pr-v2/learnings-registry.ts`, and the registry doc at `runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md`. That layer owns canonical metadata (`summary`, `owner`, `retirement_condition`), lifecycle (`disposition`, `status`, `confidence`, `follow_up`), and signature-based dedupe across runs.

What does not yet exist is the **per-issue ledger side**: every Issue-to-PR run needs a stable Workflow Learnings section in the ledger itself, recording **what this run observed**, distinct from the canonical lifecycle layer. PRD #88 splits the two surfaces deliberately so per-run evidence has a known home in the ledger and the registry stays the dedupe + lifecycle layer.

This plan adds the per-issue ledger section, the prose that explains the split, the ledger-side validator (so a ledger missing the section fails the same gate that already covers AC, Batches, and Findings), and tests for both shape and evidence form.

## Requirements

| AC | Requirement | Where addressed |
| --- | --- | --- |
| AC1 | Ledger template has a required Workflow Learnings section in a stable location with a clear run-specific evidence shape | U1 |
| AC2 | Ledger / reference prose explains ledger-records-this-run vs registry-owns-canonical-lifecycle split | U2 |
| AC3 | Helper validation rejects ledgers missing the required Workflow Learnings section | U3 |
| AC4 | Run-specific learning references can point to registry signatures without duplicating canonical entry | U1 (schema) + U2 (prose) |
| AC5 | Tests cover required section + run-specific reference/evidence shape | U4 |

## Scope boundaries

In scope:

- Per-issue ledger template at `runbooks/issue-to-pr-v2/issue-N-ledger.template.md`
- Ledger validator in `runbooks/issue-to-pr-v2/lib/ledger.ts`
- Prose updates to `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` and `runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md`
- Test coverage in `runbooks/issue-to-pr-v2/lib/ledger.test.ts`

Out of scope (deferred):

- Scan/dispatch logic that **populates** the section at ship-time or fail-stop (that is the next slice of PRD #88; this issue only lays the contract surface)
- Ledger -> registry **upsert** integration (the registry helper already supports upsert; wiring is a later slice)
- Final-checkpoint-commit guard changes to allow registry metadata writes (separate slice)
- PR-body filter so workflow learnings never appear in the PR body (separate slice)
- Changes to existing ACs, Batches, Findings, or Notes sections beyond adding the new Workflow Learnings section after Notes

## Key technical decisions

### Section location

Place `## Workflow Learnings` **after** `## Notes`, at the end of the ledger body. Rationale: Notes is the append-only evidence log for the run; Workflow Learnings is the structured cousin of Notes (also append-only per-run evidence, but with stable schema). Putting it last keeps the durable workflow-state sections (AC, Batches, Findings data, Findings) together up top where validators and gates already live, and groups the two evidence sections at the tail.

### Section shape: structured YAML inside Markdown, single block

Mirror the existing pattern used by `## Batches` and `## Findings data`: prose preamble + a single fenced ```yaml``` block holding the authoritative data. The template seeds the block with `workflow_learnings: []`. This pattern is already cemented in the ledger and the registry — using it again keeps validator code symmetric with existing helpers and makes the section human-scannable.

### Per-run evidence schema (subset of registry evidence)

Each entry in `workflow_learnings` is a per-run reference + evidence record. The schema mirrors a registry candidate's `evidence` record (so a later upsert slice can hand the record directly to `learnings-registry.ts --upsert`) and adds a `signature` field for canonical cross-reference.

```text
workflow_learnings:
  - signature: "sha256:<hex>"          # or stable slug; resolves to registry canonical entry when present
    affected_surface: "<surface>"      # mirrors registry evidence key
    what_was_wrong: "<observation>"    # mirrors registry evidence key
    discovery_method: "<how it was found>"
    root_cause: "<why>"
    scope: "<blast radius>"
    proposed_fix: "<suggested change>"
    verification_idea: "<how to confirm the fix>"
```

Notes on the schema:

- `signature` is the cross-reference to the registry. The ledger never duplicates canonical fields (`summary`, `owner`, `retirement_condition`, `disposition`, `status`, `confidence`, `follow_up`); those live exclusively in the registry. This satisfies AC4 directly.
- `affected_surface` and `what_was_wrong` are required at the registry level (they are the identifying fields `signatureFor` derives from). They are required here too so the per-run record can stand alone if the registry has not been written yet (e.g., the scan ran but upsert deferred).
- `discovery_method`, `root_cause`, `scope`, `proposed_fix`, `verification_idea` are optional — a fail-stop scan may capture only the proximate observation, while a ship-time scan captures more. Matches the PRD wording: "a run can capture only what is known."
- The `run` key from the registry evidence schema is **not** stored in the ledger record — it is implicit (the ledger IS the run). It will be injected as `issue-<N>` when the record is upserted to the registry.

### Validation behavior (AC3)

Add a `validateWorkflowLearnings(ledgerPath)` exported function in `runbooks/issue-to-pr-v2/lib/ledger.ts` that:

1. Fails if `## Workflow Learnings` is missing (matches the `## Acceptance criteria` / `## Findings data` missing-section style).
2. Fails if the section has no fenced YAML block.
3. Fails if the YAML does not parse, has no top-level `workflow_learnings` array.
4. For each entry, fails if it is not a mapping, fails if `signature` / `affected_surface` / `what_was_wrong` are missing or non-string-non-empty, fails on unknown keys (whitelist symmetry with `learnings.ts ALLOWED_EVIDENCE_KEYS` plus `signature`).
5. An **empty** `workflow_learnings: []` is valid — a run with no observed workflow learnings is the common case and must not block.

Wire into existing helpers so the validator is callable two ways:

- New CLI flag in `runbooks/issue-to-pr-v2/decompose.ts`: `--validate-workflow-learnings <ledger-path>`, dispatched to the new exported function. Symmetric with `--validate-findings`.
- Already-existing `validateLedgerBatches` and `validateFindingsData` paths run independently — do **not** auto-call workflow-learnings validation from inside them. Keep the validator opt-in via its own flag, matching the existing one-validator-per-flag pattern.

### Helper symmetry: do not import from `lib/learnings.ts`

The whitelist of evidence keys appears in two places (`lib/learnings.ts ALLOWED_EVIDENCE_KEYS` and the new validator). Tempting to import. Don't — `lib/learnings.ts` validates **registry candidates**, which carry the canonical fields (`summary`, `owner`, etc.) the ledger record explicitly omits. Different shape, different required-field set, different optional-field set. Duplicate the small constant local to `lib/ledger.ts` and let each validator own its own schema. The constant is small enough that drift risk is low; the schemas are different enough that coupling them would force conditional logic.

## High-level technical design

```text
docs/runbooks/issue-to-pr/issue-N-ledger.md  (per-run file)
  ## Acceptance criteria        <- existing
  ## Batches                    <- existing
  ## Findings data              <- existing
  ## Findings                   <- existing
  ## Notes                      <- existing
  ## Workflow Learnings         <- NEW (this plan)
    prose preamble
    ```yaml
    workflow_learnings:         <- empty by default; populated by future scan
      - signature: ...
        affected_surface: ...
        what_was_wrong: ...
        ...
    ```

runbooks/issue-to-pr-v2/
  lib/ledger.ts                 <- ADD validateWorkflowLearnings()
  lib/ledger.test.ts            <- ADD tests for required section + entry shape
  decompose.ts                  <- ADD --validate-workflow-learnings dispatch
  issue-N-ledger.template.md    <- ADD ## Workflow Learnings section
  references/
    ledger-and-helper.md        <- ADD section to "Ledger schema overview" body sections list + brief prose
    workflow-learnings-registry.md  <- TIGHTEN per-issue vs registry split prose to point at the ledger section
```

This illustrates the intended approach and is directional guidance for review, not implementation specification.

## Implementation units

### U1. Ledger template + schema

**Goal:** AC1 + AC4. Add the `## Workflow Learnings` section to the per-issue ledger template with prose explaining the per-run evidence shape, the registry signature cross-reference, and the seeded empty YAML block.

**Requirements:** AC1, AC4.

**Dependencies:** none.

**Files:**

- `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` (modify)

**Approach:**

- Append the new section after the existing `## Notes` section (and its `### runbook_version skew continuation evidence (U6)` subsection).
- Prose preamble explains: this section records what this run observed (run-specific evidence), the registry at `references/workflow-learnings-registry.md` owns canonical lifecycle metadata and dedupe, each entry's `signature` points to the registry canonical row, the ledger never duplicates `summary` / `owner` / `disposition` / `status` / `confidence` / `follow_up` / `retirement_condition`, and an empty list is valid.
- Document the required vs optional keys inline (mirror the `## Batches` and `## Findings data` style of inline schema in prose).
- Seed exactly one fenced ```yaml``` block at column 0 (matching the registry's strict closing-fence anchor convention) with body `workflow_learnings: []`.

**Patterns to follow:**

- `## Batches` and `## Findings data` sections in the same template — same prose-then-fenced-yaml pattern, same column-0 fence placement.
- `references/workflow-learnings-registry.md` — its "Append-only evidence" subsection wording for the evidence fields; reuse the phrasing where it fits.

**Test scenarios:** none for this unit by itself — it is a docs/template change; behavior is verified by U3 (the validator that consumes it) and U4 (tests).

**Verification:** the template file contains `## Workflow Learnings` followed by prose, followed by exactly one ```yaml ... ``` block with `workflow_learnings: []` at column 0. The section is the last section in the file.

### U2. Reference prose updates

**Goal:** AC2 + AC4. Update `references/ledger-and-helper.md` and `references/workflow-learnings-registry.md` so the per-issue-ledger vs registry split is explicit in both directions, and reference points at the right surface for each concern.

**Requirements:** AC2, AC4.

**Dependencies:** U1 (the section must exist before prose can describe it).

**Files:**

- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (modify)
- `runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md` (modify)

**Approach:**

- In `ledger-and-helper.md`, extend the "Ledger schema overview" body sections list (currently 1-6) with item 7: `## Workflow Learnings` and a brief description matching the rest of the list's terseness. Also add a `### Workflow Learnings entry fields` subsection (mirroring `### Frontmatter fields` and `### ## Batches entry fields`) that names the required keys, optional keys, and the canonical-fields-live-in-the-registry boundary.
- In `workflow-learnings-registry.md`, tighten the existing paragraph about "The registry is deliberately distinct from the per-issue ledger" so it explicitly points at the new ledger section as the place per-run evidence lives, and explicitly states what the ledger record does NOT carry (the canonical and lifecycle fields the registry owns).
- Both updates use the same vocabulary: ledger records **what this run observed**; registry owns **canonical lifecycle and dedupe**.

**Patterns to follow:**

- The existing `### Frontmatter fields` and `### ## Batches entry fields` subsections in `ledger-and-helper.md` — copy their density and style.
- The existing "Read trigger" prose convention in both references — extend it if needed but do not invent a new convention.

**Test scenarios:** none — pure docs change. Manual review during code review catches drift.

**Verification:** Both reference files mention `## Workflow Learnings` and the signature-cross-reference rule; `ledger-and-helper.md` lists the new section under the body-sections enumeration; `workflow-learnings-registry.md` points at the ledger section as the per-run evidence home.

### U3. Ledger validator + CLI dispatch

**Goal:** AC3. Add `validateWorkflowLearnings(ledgerPath)` to `lib/ledger.ts` and dispatch it via `decompose.ts --validate-workflow-learnings`.

**Requirements:** AC3.

**Dependencies:** U1.

**Files:**

- `runbooks/issue-to-pr-v2/lib/ledger.ts` (modify — add exported function near `validateFindingsData`)
- `runbooks/issue-to-pr-v2/decompose.ts` (modify — add flag dispatch)

**Approach:**

- Implement `validateWorkflowLearnings(ledgerPath: string): void` in `lib/ledger.ts`.
- Section extraction: reuse whatever section-extractor helper `validateFindingsData` uses (look for the existing private helper that grabs `## Findings data`); apply it to `## Workflow Learnings`. Section missing fires `fail('ledger ${ledgerPath} has no ## Workflow Learnings section')`.
- Fenced-yaml extraction: reuse the same regex / scan pattern `validateFindingsData` uses for `## Findings data`. No block: `fail('## Workflow Learnings has no fenced yaml block')`. Multiple blocks within the section: `fail('## Workflow Learnings must contain a single fenced yaml block')`.
- YAML parse via `Bun.YAML.parse`. Missing top-level `workflow_learnings` array: `fail('## Workflow Learnings yaml block has no "workflow_learnings" array at the top level')`.
- Per-entry checks (entry must be a mapping; required string fields `signature`, `affected_surface`, `what_was_wrong` non-empty; unknown keys rejected against a local whitelist). Empty `workflow_learnings: []` is valid and returns without error.
- Error messages name the offending entry by `signature` when present, otherwise by 1-based index — match `lib/learnings.ts entryLabel` style.
- Export the function alongside the other exported validators.
- In `decompose.ts`: import the new function; add a flag handler `--validate-workflow-learnings <ledger-path>` right after `--validate-findings`; update the usage string.

**Patterns to follow:**

- `validateFindingsData` in `lib/ledger.ts` — same fail-on-missing-section style, same exit-on-error contract via `fail()`.
- `validateRegistry` and the evidence-key whitelist in `lib/learnings.ts` — same kind of small local-const whitelist + `entryLabel` style.
- The `--validate-findings` dispatch block in `decompose.ts` — copy the structure verbatim.

**Test scenarios:** covered by U4 to keep that unit's single-purpose test file change clean.

**Verification:** `bun runbooks/issue-to-pr-v2/decompose.ts --validate-workflow-learnings <ledger-path>` exits `0` on a valid ledger (template-shaped or with valid entries) and exits non-zero with an actionable stderr message on any failure mode listed above. The exported function is also callable from the test suite without going through the CLI.

### U4. Tests for ledger section + validator

**Goal:** AC5. Add unit tests for `validateWorkflowLearnings` covering the required section shape, valid empty case, valid populated case, every failure mode, and the unknown-key rejection contract.

**Requirements:** AC5.

**Dependencies:** U1, U3.

**Files:**

- `runbooks/issue-to-pr-v2/lib/ledger.test.ts` (modify — add test block for the new validator)

**Approach:**

- Add a new `describe('validateWorkflowLearnings', ...)` block at the end of the file.
- Reuse the existing `writeLedgerWithFrontmatter(frontmatter, body)` helper (visible in current tests, e.g., the `## Notes` continuation-evidence tests) to build minimal ledger fixtures that vary only the `## Workflow Learnings` section.
- Wrap the validator in `withFailMode("throw", () => ...)` so the tests assert on thrown `DecomposeError` messages (matches the existing pattern in `ledger.test.ts`).
- Use `bun_runTests` (MCP runner, JSON output) to verify — never raw `bun test`.

**Execution note:** test-first. The failure modes are enumerable and the function is pure-validation — writing the tests before the implementation will catch off-by-one slip-ups in section extraction and the unknown-key whitelist.

**Test scenarios (enumerate the full set):**

- Covers AC5. **Happy: empty section**. Ledger with `## Workflow Learnings` + fenced yaml `workflow_learnings: []` validates without error.
- Covers AC5. **Happy: one valid entry**. Ledger with one entry that has `signature`, `affected_surface`, `what_was_wrong` all non-empty validates without error.
- Covers AC5. **Happy: multiple valid entries**. Two entries, both with required fields, all optional fields present on one and absent on the other — validates.
- **Missing section**. Ledger built without `## Workflow Learnings` at all -> fails with message naming the ledger path and the missing section header.
- **Section present, no fenced yaml block**. `## Workflow Learnings` heading followed only by prose -> fails with "no fenced yaml block" message.
- **Multiple fenced yaml blocks in the section**. Two ```yaml ... ``` blocks under the heading -> fails with "must contain a single fenced yaml block".
- **YAML parse error**. Malformed yaml inside the block -> fails with yaml-parse error including the ledger path.
- **Missing top-level `workflow_learnings` key**. Block parses but no array -> fails with "no workflow_learnings array".
- **`workflow_learnings` is not an array**. Top-level is a mapping or string -> fails.
- **Entry not a mapping**. Array contains a scalar -> fails identifying the entry by index.
- **Entry missing `signature`**. Entry has `affected_surface` + `what_was_wrong` but no `signature` -> fails naming the missing field and the entry index.
- **Entry missing `affected_surface`**. Symmetric to above.
- **Entry missing `what_was_wrong`**. Symmetric to above.
- **Entry has empty-string `signature`**. -> fails (non-empty string required).
- **Entry has unknown key `disposition`**. Should be rejected because canonical/lifecycle fields belong in the registry, not the ledger -> fails listing allowed keys.
- **Entry has unknown key `owner`**. Symmetric — confirms registry canonical fields cannot be smuggled in.
- **Entry has unknown key `garbage_key`**. Generic unknown-key rejection.
- **Entry labeled by signature in error message**. When an entry has a valid `signature` but a missing required field, the error message includes that signature string (mirrors `lib/learnings.ts entryLabel`).
- **Entry labeled by 1-based index when signature absent**. Confirms fallback.

**Patterns to follow:**

- Existing `validateFindingsData` tests in the same file — same fixture helper, same `withFailMode("throw", ...)` assertion shape.
- The continuation-evidence tests (`## Notes` block) for fixture-building examples.
- `lib/learnings.test.ts` for evidence-shape rejection patterns.

**Verification:** `bun_runTests` reports all new tests passing; `tsc_check` shows no type regressions in `lib/ledger.ts` or `decompose.ts`; `biome_lintCheck` is clean for the changed files.

## Dependencies between units

```text
U1 (template + schema)
  └── U2 (reference prose)
  └── U3 (validator + CLI dispatch)
        └── U4 (tests)
```

U1 unlocks both U2 and U3 (independent of each other). U4 depends on U3.

## Risks and mitigations

- **Risk:** existing ledgers in this repo do not yet have the new section, so any path that runs `--validate-workflow-learnings` against an old ledger will fail. **Mitigation:** the new validator is opt-in via its own flag and is not chained from `validateLedgerBatches` or `validateFindingsData`; the active ledger for this very run (`docs/runbooks/issue-to-pr/issue-91-ledger.md`) will be updated by hand in Stage 4 / Stage 5 of this issue's pipeline to include the section before the validator runs against it.
- **Risk:** schema drift from the registry's evidence schema if the registry adds a key later. **Mitigation:** keep the local whitelist constant near the validator with a short comment pointing at `lib/learnings.ts ALLOWED_EVIDENCE_KEYS` so future readers see the two locations together.
- **Risk:** placing the new section after `## Notes` could collide with the existing `### runbook_version skew continuation evidence (U6)` subsection inside Notes. **Mitigation:** `## Workflow Learnings` is an `##` heading (level 2), terminating the `### ...` subsection cleanly. The section-extractor helper in `lib/ledger.ts` already handles level-2 boundaries correctly (that's how `## Batches` ends `## Acceptance criteria` today).

## Deferred to follow-up work

- Scan/dispatch that populates `workflow_learnings` at ship-time and fail-stops (next slice of #88).
- Wiring the ledger's per-run entries into a registry upsert via `learnings-registry.ts --upsert`.
- Final-checkpoint-commit guard updates so registry metadata writes are allowed in the same commit as the ledger checkpoint.
- PR-body filter so workflow learnings never appear in the product PR body.

```yaml
id: ledger-template-section
name: Ledger template + schema
goal: "AC 1 holds: The ledger template includes a required Workflow Learnings section in a stable location and with a clear run-specific evidence shape."
files:
  - runbooks/issue-to-pr-v2/issue-N-ledger.template.md
depends_on: []
execution_mode: change_first
acceptance_tests:
  - "AC 1 holds: the template file contains a ## Workflow Learnings section at the tail of the body, with a prose preamble, with exactly one fenced yaml block at column 0, and the block body is `workflow_learnings: []`"
  - "AC 4 holds: the prose explains entries use signature to point at registry canonical entries without duplicating canonical fields"
ac_mapping:
  - 1
  - 4
rationale: "change_first-exception: pure docs/template change; behaviour is verified by U3 validator and U4 tests"
```

```yaml
id: reference-prose
name: Reference prose updates
goal: "AC 2 holds: Ledger/reference prose explains that the per-issue ledger records what this run observed, while the registry owns canonical lifecycle metadata and dedupe."
files:
  - runbooks/issue-to-pr-v2/references/ledger-and-helper.md
  - runbooks/issue-to-pr-v2/references/workflow-learnings-registry.md
depends_on:
  - ledger-template-section
execution_mode: change_first
acceptance_tests:
  - "AC 2 holds: ledger-and-helper.md body-sections list includes ## Workflow Learnings and a Workflow Learnings entry fields subsection names the required keys and the canonical-fields-live-in-registry boundary"
  - "AC 2 holds: workflow-learnings-registry.md prose points at the new ledger section as the per-run evidence home and states which fields the ledger does NOT carry"
  - "AC 4 holds: both files name the signature cross-reference rule"
ac_mapping:
  - 2
  - 4
rationale: "change_first-exception: pure docs change to reference files; behaviour is the documented split, verified by reading"
```

```yaml
id: ledger-validator
name: Ledger validator + CLI dispatch
goal: "AC 3 holds: Helper validation rejects ledgers missing the required Workflow Learnings section once they are authored against the updated contract."
files:
  - runbooks/issue-to-pr-v2/lib/ledger.ts
  - runbooks/issue-to-pr-v2/decompose.ts
depends_on:
  - ledger-template-section
execution_mode: tdd
acceptance_tests:
  - "AC 3 holds: validateWorkflowLearnings throws on a ledger missing the ## Workflow Learnings section"
  - "AC 3 holds: validateWorkflowLearnings accepts an empty workflow_learnings: [] block"
  - "AC 3 holds: validateWorkflowLearnings rejects entries missing signature, affected_surface, or what_was_wrong"
  - "AC 3 holds: --validate-workflow-learnings flag dispatches to the new validator and exits non-zero on failure"
ac_mapping:
  - 3
rationale: null
```

```yaml
id: validator-tests
name: Tests for ledger section + validator
goal: "AC 5 holds: Tests cover the required section and the expected run-specific reference/evidence shape."
files:
  - runbooks/issue-to-pr-v2/lib/ledger.test.ts
depends_on:
  - ledger-validator
execution_mode: tdd
acceptance_tests:
  - "AC 5 holds: tests cover happy path (empty + populated), missing section, no fenced block, multiple blocks, yaml parse error, missing workflow_learnings key, non-array, entry-not-mapping, missing required fields, empty-string required fields, unknown keys (including canonical/lifecycle field rejection), and entry-labeling-by-signature-vs-index"
ac_mapping:
  - 5
rationale: null
```
