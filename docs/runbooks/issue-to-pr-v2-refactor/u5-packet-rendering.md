# Runbook: V2 packet rendering and envelope boundaries (U5)

**Seam:** A new module `runbooks/issue-to-pr-v2/lib/packets.ts` plus additive
`packet <role>` subcommands on the v2 CLI. The seam renders complete role
packets (Builder, Proposer, Validator, patch-proposal, ce-plan) from the
U2 templates plus durable ledger state. The Orchestrator never assembles
prompts from prose anymore — the CLI emits a packet on request, prose
selects when a packet is allowed.

**Central risk: context leaks.** The plan literally names this as the
central risk for U5. A Builder packet that accidentally carries the full
plan, unrelated batches, raw Validator envelopes, or full ledger content
is a P0. Every packet has both a "MUST include" allow-list and a
"MUST NOT leak" deny-list, and the audit verifies both.

**Ledger:** [u5-packet-rendering-ledger.md](u5-packet-rendering-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/lib/packets.ts` (new)
- `runbooks/issue-to-pr-v2/lib/packets.test.ts` (new)
- `runbooks/issue-to-pr-v2/cli.ts` (additive: `packet <role>` subcommands)
- `runbooks/issue-to-pr-v2/cli.test.ts` (additive: AC fixtures for each
  new subcommand)
- `runbooks/issue-to-pr-v2/templates/builder-work-packet.md` (modify:
  placeholder syntax that `lib/packets.ts` fills)
- `runbooks/issue-to-pr-v2/templates/proposer-envelope.md` (modify)
- `runbooks/issue-to-pr-v2/templates/validator-envelope.md` (modify)
- `runbooks/issue-to-pr-v2/templates/patch-proposal.md` (modify)
- `runbooks/issue-to-pr-v2/templates/ce-plan-addendum.md` (modify)
- `runbooks/issue-to-pr-v2/references/builder-dispatch.md` (modify:
  document the packet rendering contract; do NOT restate role
  boundaries that already live in U2 prose)
- `runbooks/issue-to-pr-v2/references/findings-and-validators.md` (modify:
  same — packet rendering contract only)
- `runbooks/issue-to-pr-v2/templates/builder-return-envelope.md` (the
  U4-deferred file — create as a sibling to builder-work-packet.md per
  the plan's U5 file list; cross-reference the existing return envelope
  schema in builder-dispatch.md rather than re-declaring it)

**Read-only (U2/U3/U4 surface — preserve except where named writable):**

- `runbooks/issue-to-pr-v2/lib/contract.ts`
- `runbooks/issue-to-pr-v2/lib/digest.ts`
- `runbooks/issue-to-pr-v2/lib/ledger.ts` (use `readLedgerSnapshot`,
  `parse`, `readLedgerBatchContext`, the typed exports — do NOT add new
  exports unless the audit proves they're required and within scope)
- `runbooks/issue-to-pr-v2/lib/cli-envelope.ts`
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts`
- `runbooks/issue-to-pr-v2/lib/route.ts`
- `runbooks/issue-to-pr-v2/decompose.ts`
- All `runbooks/issue-to-pr-v2/references/*.md` not named writable above

**Read-only (v1 sources — frozen until U7):**

- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (anchors — this seam consumes them):**

- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 anchor)

## What U5 is NOT — explicit anti-list

These belong to other units and must not be implemented here. If the audit
surfaces a finding that requires touching one of these, close it with the
matching `not-in-u5-scope` reason:

- **Notes-evidence ledger writes (U6 territory).** The plan mentions
  "minimal dispatch evidence shape for ledger Notes: timestamp, role,
  batch or finding id, loaded references/templates, and CLI route id."
  U5 may **define the shape** in `lib/packets.ts` (typed return value
  of the packet render call) but must **not write to ledger Notes** —
  ledger mutation requires U6's runbook_version-aware write infrastructure.
  CLI commands stay read-only per ADR 0002 / R-no-orchestrator-CLI.
- **`runbook_version` field detection (U6).** U4 already reports
  `version_skew: "matched"` as a forward-compat default. U5 must not
  add `runbook_version` reading logic.
- **Hot router wiring (U7).** U5's packet rendering is invoked
  on-demand via CLI; the rule for *when* a packet should be rendered
  (which prose triggers it) is a U7 concern. U5 ships the renderer; U7
  wires it.
- **Real install-artifact filesystem walks (U9).** The U4
  `installedArtifactPresence` stub stays true-baseline.
- **LogTape integration / AsyncLocalStorage propagation (deferred to
  U7 per the U4 observability handoff).** U5 uses `emitDiagnostic` as
  it stands.

## Suggested reviewer personas

Always-on (every sweep):

- `compound-engineering:ce-correctness-reviewer` — does each rendered
  packet contain exactly the documented fields, with the right values
  derived from ledger state?
- `compound-engineering:ce-api-contract-reviewer` — are the JSON
  envelope schemas stable for each `packet <role>` subcommand? Do they
  preserve the U4 envelope contract (status, schema_version, run_id,
  duration_ms)?
- `compound-engineering:ce-scope-guardian-reviewer` — does cli.ts stay
  thin? Does the seam respect the U5 anti-list above? No premature U6
  ledger writes, no U7 routing logic?
- `compound-engineering:ce-testing-reviewer` — are the inclusion AND
  exclusion assertions strong? "MUST NOT leak" is the central
  containment proof; rubber-stamping it is P1.
- `compound-engineering:ce-security-sentinel` — packet leakage is a
  containment failure. The security lens specifically asks: can a
  Builder packet ever surface a finding it shouldn't see (e.g.,
  another batch's P0/P1)? Can a Validator packet surface a Builder
  authority breach as authorized prompt content? Can a Proposer packet
  leak terminal-batch builder commits beyond the ones it needs for
  dependency validation?

Conditional:

- `compound-engineering:ce-kieran-typescript-reviewer` — added when the
  `lib/packets.ts` diff grows beyond ~200 lines, since the typed
  packet shapes need to compose with U3's existing typed snapshot APIs.

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split)** — packet rendering is
  mechanical. The CLI invokes `lib/packets.ts` deterministically; prose
  decides *when* to invoke. A packet that requires Orchestrator judgment
  to assemble (e.g., "include this batch only if the user said yes") is a
  P0 ADR violation.
- **ADR 0002 (CLI emits facts, not orchestration)** — packet output is
  a fact: "given this ledger state and this role + target, here is the
  payload." No imperative verbs. A field named `next_action` or
  `recommended_step` is a P0.
- **R-no-orchestrator-CLI** — packet commands are read-only. No git
  mutations, no ledger writes. Dispatch-evidence shape is defined here
  but written by U6 + U7.
- **R3 (lib/* module split)** — packet rendering logic lives in
  `lib/packets.ts`. Putting render logic directly into the CLI
  dispatcher (like U4's F020 catch) is P1.
- **R8 (deterministic from templates + ledger)** — same ledger state +
  same role + same target id MUST yield byte-identical packet output
  (modulo run_id and timestamps). Hidden non-determinism is P1.
- **R9 (Proposer read-only)** — the Proposer packet must not contain
  any field that lets the Proposer write. No commit_sha slot, no
  builder_attempts slot, no scratch-file-write directive.
- **R10 (preserve U3/U4 split)** — `lib/packets.ts` uses the existing
  U3 exports + U4 envelope helpers. No new exports added to U3 modules
  unless the audit proves them necessary and in-scope.
- **R13 (explicit ledger evidence)** — packet rendering returns the
  dispatch evidence shape (timestamp, role, target id, loaded
  references/templates, CLI route id) but does NOT persist it. U6 owns
  the write.
- **No XML-wrapping helper-validated YAML** — same rule as U2/U4.
  Selective XML framing for prose-only contract sections in templates
  is allowed; wrapping a fenced YAML block in `<yaml>` is P1.
- **No-context-leak rule (the U5 central invariant)** — every packet
  has a documented allow-list and deny-list. Tests assert both
  directions. A packet that includes a field outside its allow-list,
  or that fails to exclude a field on its deny-list, is **P0**.

## Per-packet contracts (MUST include / MUST NOT leak)

These are the contractual surfaces the audit checks. Every test fixture
must cover both directions.

### Builder Work Packet

**MUST include** (per `templates/builder-work-packet.md`):

- `issue_number`, `target_repo`
- `attempt_type: "implementation" | "repair"`
- `target_finding_signature: <signature | null>`
- The confirmed `batch_contract` for the target batch only (id, name,
  goal, files, depends_on, supersedes, execution_mode, acceptance_tests,
  ac_mapping, rationale)
- `iteration: <int>` plus existing `builder_commits` and compact prior
  `builder_attempts` **for this batch only**
- `## Findings data` rows **for this batch only**
- Non-authoritative Notes summaries **for this batch only**
- The four prose framing slots: `<local_law_read_order>`,
  `<preflight_checklist>`, `<allowed_probes>`, `<output_contract>`
  filled from the references

**MUST NOT leak:**

- The full plan file
- The full ledger contents
- Raw Validator envelopes
- Unrelated batch state (any batch other than the target)
- Rich Builder evidence not persisted in compact `builder_attempts`
  (implementation_steps, existing_seams_used, tests_run, assumptions,
  risks, deferred from prior envelopes)
- ACs not in the target batch's `ac_mapping`
- Findings from other batches or stage-3 findings

### Proposer Envelope

**MUST include:**

- `issue_number`, `target_repo`
- The cited `final_finding_row` (id, signature, persona, severity,
  summary, evidence)
- `confirmed_batch_summaries`: only the terminal-success batch ids,
  their files, and their status — needed for terminal-dependency
  and file-scope checks
- `confirmation_state_snapshot` (acceptance_criteria, batch_contract,
  digests)
- Local Law Read Order pointer, patch-proposal helper contract pointer,
  scratch proposal schema pointer

**MUST NOT leak:**

- Any commit-write slot (no `commit_sha`, no `builder_commits`)
- `builder_attempts` from any batch (Proposer is read-only)
- The full ledger
- Unrelated raw Validator envelopes (only the cited finding row)
- Findings outside `batch_id: final`
- Whole-plan content (Proposer doesn't replan)

### Validator Envelope

**MUST include:**

- `persona` (exact skill name with plugin namespace)
- `commit_ref_or_range`
- `touched_files`, `batch_id`, `batch_goal`, `batch_files`,
  `execution_mode`, `acceptance_tests`, `ac_mapping`
- `relevant_ledger_findings` (this batch only)
- `builder_evidence` shape (implementation_steps, existing_seams_used,
  tests_run, assumptions, risks, deferred, suggested_validator_focus)
- `orchestrator_transient_focus` slot (may be empty)

**MUST NOT leak:**

- Builder authority-breach details promoted to authorized prompt
  content (Validator must see "Builder edited X" as a fact, never as
  "X is allowed")
- Findings from other batches
- The full ledger
- Builder fix prose (Validator is read-only; if Builder envelope
  contained a fix recommendation, the Orchestrator stripped it before
  packet render — verify this stripping happens in `lib/packets.ts`)

### Patch proposal scratch file

**MUST include:**

- `final_finding` reference (id, signature, persona, severity,
  summary)
- Exactly one `patch_batches` entry with: `id: patch-NNN`, `name`,
  `goal`, `files`, `depends_on` (terminal-ledger-backed),
  `execution_mode`, `acceptance_tests`, `ac_mapping: []`, `rationale`
- The recommended `replacement-contract:` rationale prefix
  documentation (U2 already documented this — verify it's still
  present)

**MUST NOT leak:**

- More than one `patch_batches` entry
- Wildcard paths
- `ac_mapping` values (must be `[]`)
- Findings beyond the cited `final_finding`

### ce-plan addendum

**MUST include:**

- The verbatim structured-output requirement from the v1 prose
  (`tdd | proof_first | change_first` definitions, splitting/merging
  rules, fenced YAML schema)

**MUST NOT leak:**

- Issue-specific content (the addendum is reusable across issues)
- Builder / Validator / Proposer packet content

## Scoped audit prompt

````
Review U5 packet rendering in `runbooks/issue-to-pr-v2/lib/packets.ts`,
its tests in `runbooks/issue-to-pr-v2/lib/packets.test.ts`, the new
`packet <role>` CLI subcommands in `runbooks/issue-to-pr-v2/cli.ts` and
`cli.test.ts`, the five role templates under `runbooks/issue-to-pr-v2/
templates/`, and the targeted edits to
`runbooks/issue-to-pr-v2/references/builder-dispatch.md` and
`findings-and-validators.md`. Cross-check against U2/U3/U4 reference
material and the U1 regression matrix.

Audit items:

1. Does `lib/packets.ts` render Builder, Proposer, Validator,
   patch-proposal, and ce-plan packets deterministically from
   templates + ledger state? Same inputs always produce byte-identical
   output (modulo run_id / timestamps)?
2. Does each rendered packet match its documented MUST-include
   allow-list verbatim (Per-packet contracts above)?
3. Does each rendered packet exclude every field on its MUST-NOT-leak
   deny-list? Are exclusion assertions explicit in the tests, not
   inferred from inclusion?
4. Does the Builder packet contain exactly one batch_contract — the
   target batch — and no others? Are findings, builder_attempts, and
   Notes summaries scoped to that batch only?
5. Is the Proposer packet read-only by construction? No commit slot,
   no builder_attempts, no scratch-file-write directive.
6. Is the Validator packet read-only by construction? Does it strip
   Builder fix recommendations before render?
7. Do the new CLI subcommands (e.g. `packet builder --batch <id>
   --ledger <path> --json`) require `--json`? Do they preserve the U4
   envelope shape (status, schema_version, run_id, started_at_ms,
   duration_ms)?
8. Is the dispatch evidence shape (timestamp, role, target id,
   loaded references/templates, CLI route id) returned but NOT
   persisted to ledger? (R13 + U5 anti-list.)
9. Does cli.ts stay a thin dispatcher? Logic in cli.ts that should
   live in lib/packets.ts is P1 (mirrors U4 F020).
10. Are XML framing tags used only for prose framing? Helper-validated
    YAML / JSON / Markdown examples stay fenced.
11. Does each template's "Read trigger" remain visible after the U5
    placeholder syntax edits?
12. Does the seam respect the U5 anti-list (no ledger writes, no
    runbook_version logic, no hot router wiring)?

Severity:
- P0: context leak (any field outside the documented allow-list or
  inside the deny-list), Proposer/Validator write surface introduced,
  imperative output in any packet, ledger mutation by the CLI,
  non-deterministic packet output, ADR 0001/0002 violation
- P1: logic in cli.ts instead of lib/packets.ts, U4 envelope schema
  drift, missing exclusion assertion, XML-wrapping helper-validated
  YAML, R8 determinism break that does not leak context
- P2: missing test fixture for a documented allow/deny entry,
  paraphrased prose that weakens an invariant, packet shape change
  not reflected in the template
- P3: minor formatting, ordering, wording issues

Return findings with stable kebab-case signatures (e.g.
`builder-packet-leaks-full-plan`, `proposer-packet-has-commit-slot`,
`packet-cli-mutates-ledger-notes`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT
propose edits to `runbooks/issue-to-pr-v2/references/regression-matrix.md`
(U1 owns it). Do NOT propose edits to U3 or U4 internals beyond what
the U5 writable list names.
````

## Closing a finding without fixing it

Seam-specific close reasons (in addition to the shared
`out-of-scope-for-this-issue`, `ADR-contradicts-<id>`, and
`fails-graduation-test`):

- `not-in-u5-scope` — finding is real but belongs to U6 (notes-evidence
  writes, runbook_version), U7 (router wiring), or U9 (regression
  probes / real install diagnostics). Note the future seam in the
  resolution.
- `owned-by-u1-matrix` — finding is a matrix-coverage issue. Route
  back to U1.
- `deferred-to-u6-ledger-writes` — finding is about persisting dispatch
  evidence to ledger Notes; the shape is defined here, the write
  lands in U6.
- `deferred-to-u7-router` — finding is about when a packet should be
  rendered (the prose trigger), not how.

## /loop fallback

```
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u5-packet-rendering.md.
Re-read the runbook and u5-packet-rendering-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```

Convergence is the README's [Convergence
protocol](README.md#convergence-protocol): two consecutive independent
clean passes from different angles, not zero-open after one pass. A
pass that files or fixes a finding resets the counter.
