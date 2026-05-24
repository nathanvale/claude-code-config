# First-run gotchas: CLI evidence recipes

**Read trigger:** open this guide when an Issue-to-PR run lands in a state
that looks wrong but probably is not, or in a blocked route whose recovery
is not obvious from the route id alone. It is a recovery overlay, not a
second runbook. For full stage playbooks use the stage references; for the
ledger schema and route catalog use
[ledger-and-helper.md](ledger-and-helper.md).

## How to read this guide

This guide is symptom-first. Find the symptom or the `route_id` you are
seeing, then follow its **CLI evidence recipe**: the exact command to run,
the JSON fields to inspect, what those fields prove, and the recovery action
that follows. A short **model note** explains the underlying state-machine
concept so the recipe teaches, not just unblocks.

A **CLI evidence recipe** pairs a confusing operator state with the
observable CLI facts that identify it and the recovery meaning of those
facts (see `CONTEXT.md`). Run every command from the **target repo root**;
running a helper from the installed runbook directory or a different checkout
validates the ledger against the wrong git repository and produces false
drift.

Two command families appear in these recipes, and they take different flags:

- **`cli.ts` probes** (`state`, `diagnose`, `contract`) are JSON fact
  emitters. Every `cli.ts` command requires `--json` and writes one envelope
  to stdout. The CLI is read-only (ADR 0002): it never says "run X". It tells
  you where the workflow sits; you choose the recovery.
- **`decompose.ts` validators** (`--validate-ledger-batches`,
  `--assert-no-open-p0p1`, the `--*-digest` flags) are line-oriented checks.
  They do **not** take `--json`; they print human-readable lines on stdout
  and signal pass/fail through the exit code (`0` pass, non-zero violation).
  Adding `--json` to a `decompose.ts` command makes it print a usage error
  and skip the check, so read its exit code, not a JSON envelope.

`{ledger}` below is shorthand for
`docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md`. The recipes show
the repo-local helper path `runbooks/issue-to-pr-v2/`; if your host installs
the runbook elsewhere, substitute the host-resolved path (`SKILL.md` calls
this `{v2-cli}`, which is `~/.claude/runbooks/issue-to-pr-v2/cli.ts` in a
Claude Code install). Always run helpers from the target repo root, whatever
the helper path.

If you are seeing digest drift but no specific `*-stale` route fired, read
the `blocked-digests-stale` recipe (Part 2.3): it is the lowest-precedence
stale gate, reached only after the more specific
`blocked-acceptance-criteria-stale` and `blocked-batch-contract-stale` gates
are ruled out, so it is where plan-digest drift surfaces.

## Entry governance

This guide must not become a junk drawer. A gotcha may enter only if it has
all of: a concrete symptom or route id, a CLI evidence recipe, a recovery
action, an owner classification, and a retirement trigger. Each entry ends
with **Owner** and **Retire when** lines. The keep test for every entry:
*does this help an operator recover from a confusing state?* If it only
restates canonical reference material, it belongs in a reference or a
follow-up issue, not here.

Owner classifications:

| If the gotcha shows... | Owner classification |
| --- | --- |
| The operator did not understand a valid state | `gotchas guide` |
| The operator could not find help at the point of pain | `skill link` |
| The reference prose was wrong or incomplete | `runbook reference` |
| The CLI cannot prove the state | `CLI observability follow-up` |
| The recovery path or workflow contract is bad | `workflow contract issue` |

---

## Part 1: Observed sharp edges

These are valid states that look cryptic on a first run.

### 1.1 Digest timing: a digest field is null and you think the ledger is broken

**Symptom.** Early in a run, `ac_digest` is set but `plan_digest` and
`batch_contract_digest` are `null` in the ledger frontmatter. It looks like
the digests failed to compute.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json
```

**JSON fields to inspect.** `data.route_id`,
`data.confirmation_state.{acceptance_criteria, batch_contract, digests}`,
`data.plan_path`, `data.has_batches`.

**What the fields prove.** If `route_id` is `plan` or `decompose` with
`confirmation_state.acceptance_criteria: "confirmed"` and `plan_path: null`
(or `has_batches: false`), the null digests are expected, not broken: the
source content those digests cover does not exist yet.

**Recovery / next.** Continue the happy path. Each digest is computed at the
stage that produces its source content: `ac_digest` at Stage 1,
`plan_digest` at Stage 2 (after `plan_path` is set), `batch_contract_digest`
at Stage 3 confirmation. Do not hand-edit digest fields. The orchestrator
recomputes them via `decompose.ts --ac-digest`, `--plan-digest`, and
`--batch-contract-digest`; see
[ledger-and-helper.md](ledger-and-helper.md#frontmatter-fields).

**Model note.** Digests anchor a confirmation to a specific snapshot of
content. A digest over content that does not exist yet is meaningless, so it
stays null until its stage runs. A null *stored* digest never routes to
`blocked-digests-stale`: it yields `confirmation_state.digests: "pending"`
(`lib/ledger.ts` `readDigestState`), which routes to the happy-path stage
that produces that content. `blocked-digests-stale` fires only when a digest
is *populated* but no longer matches its recomputed source content (Part
2.3). So null-before-stage is normal `pending`; populated-but-mismatched
after stage is the stale route.

**Owner:** `gotchas guide`.
**Retire when** `cli.ts diagnose` emits a per-field "digest pending vs.
drifted" hint, or this state stops confusing operators in practice.

### 1.2 List-typed Builder attempt fields look malformed

**Symptom.** In `## Batches`, a `builder_attempts` record shows `blockers`
and `probe_results` as YAML lists (`[]` when empty), not single strings. It
looks inconsistent next to `notes`, which is one string. You assume the
ledger is malformed and reach to collapse the lists into delimited
strings to "tidy" it, which is the edit that actually breaks validation.

**Command.**

```
bun runbooks/issue-to-pr-v2/decompose.ts --validate-ledger-batches {ledger}
```

**JSON fields to inspect.** Per-batch `builder_attempts[].blockers` and
`builder_attempts[].probe_results` in `## Batches`; the helper exit code.

**What the fields prove.** If `--validate-ledger-batches` exits `0`, the
list shape is correct. `blockers` and `probe_results` are YAML lists of
compact strings by contract; `notes` is a single string. A zero exit proves
the shape is intended, not corrupt.

**Recovery / next.** Leave the lists as lists. Do not collapse them into
strings to "tidy" the ledger; that is what would actually break validation.
See [ledger-and-helper.md](ledger-and-helper.md#-batches-entry-fields) for
the full `builder_attempts` record contract.

**Model note.** Builder attempt records keep rich evidence out of the ledger
and store only compact, list-or-string fields. The list typing is a
deliberate schema choice so multiple blockers or probe results survive
without being jammed into one delimited string.

**Owner:** `gotchas guide`.
**Retire when** the ledger template ships an inline comment documenting the
list typing at the `builder_attempts` field, making the shape self-evident.

### 1.3 Candidate-vs-ledger batch digest mismatch

**Symptom.** You re-ran decomposition or tweaked the plan, and now the run
routes `blocked-batch-contract-stale`, even though the *confirmed* `##
Batches` block in the ledger looks untouched. It feels like a false alarm
caused by comparing a freshly serialized candidate contract against the
stored ledger contract.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json
bun runbooks/issue-to-pr-v2/cli.ts diagnose {ledger} --json
```

**JSON fields to inspect.** `data.route_id` (state),
`data.drift.digest_drift.batch_contract` (diagnose),
`data.drift.digest_drift.any` (diagnose),
`data.confirmation_state.batch_contract` (state).

**What the fields prove.** `route_id: "blocked-batch-contract-stale"` with
`drift.digest_drift.batch_contract: true` proves the stored
`batch_contract_digest` no longer matches the *current* `## Batches`
content in the ledger. The digest is computed over the confirmed ledger
block, not over a candidate serialization, so a true here means the ledger's
own batches block drifted from its stored digest, not that a candidate is
being mis-compared.

**Recovery / next.** Return to Stage 3. Recompute
`batch_contract_digest` over the confirmed `## Batches` block via
`decompose.ts --batch-contract-digest {ledger}`, re-present the contract,
and get user confirmation before resuming Stage 4. If the `## Batches`
content is genuinely unchanged and the digest still mismatches, that is a
real drift to investigate, not a comparison artifact. See
[stage-3-decompose.md](stage-3-decompose.md).

**Model note.** The digest covers only the immutable batch-contract fields,
not the runtime lifecycle fields Stage 4 mutates, so Stage 4 progress never
trips this gate. For the exact split of immutable versus runtime fields see
[ledger-and-helper.md](ledger-and-helper.md#helper-execution-context), the
canonical source (not re-enumerated here, so the two surfaces can't drift).
If you believe a candidate serialization is being compared instead of the
ledger block, that is a CLI-observability question: the CLI only ever digests
the stored ledger content.

**Owner:** `gotchas guide`.
**Retire when** `cli.ts diagnose` reports which field of the batch contract
drifted (rather than a single `batch_contract: true` boolean), so the
candidate-vs-ledger confusion cannot arise.

### 1.4 Atomic converge and finding closure in one checkpoint

**Symptom.** A fixing commit makes a batch terminal, but a finding still
shows `open`, and the run will not converge. You are unsure whether to close
the finding in a separate commit or the same one.

**Command.**

```
bun runbooks/issue-to-pr-v2/decompose.ts --assert-no-open-p0p1 {ledger}
bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json
```

**JSON fields to inspect.** The `--assert-no-open-p0p1` exit code;
`data.all_batches_terminal` and `data.route_id` from `state`.

**What the fields prove.** A non-zero `--assert-no-open-p0p1` exit proves
an open P0/P1 still blocks convergence. If you mark the batch `converged`
in one commit but leave the finding `open`, the next `state` read will not
advance because the no-open-P0/P1 gate still fails.

**Recovery / next.** Close the finding in the **same** lifecycle checkpoint
that makes the fixing commit terminal: update `## Findings data` (and the
mirrored `## Findings` table) to the resolved status and flip the batch to
`converged` in one commit. Re-run `--assert-no-open-p0p1`; a zero exit and
`all_batches_terminal: true` confirm convergence. See
[findings-and-validators.md](findings-and-validators.md).

**Model note.** Convergence is a gate, not a timestamp. The ledger is the
single source of truth, so a terminal batch and a resolved finding must be
true together at the same committed state. Splitting them leaves an
intermediate committed state that still reads as blocked.

**Owner:** `gotchas guide`.
**Retire when** the Stage 4 converge reference makes the same-checkpoint
requirement explicit at the converge step and operators stop splitting it.

---

## Part 2: Adjacent blocked-state recovery recipes

These are the blocked `route_id` values an operator is most likely to hit.
Each one is a deliberate fail-closed gate. The recovery is always operator
action, never a CLI flag.

### 2.1 `blocked-acceptance-criteria-stale`

**Symptom / route id.** `route_id: "blocked-acceptance-criteria-stale"`.
The AC list was edited after confirmation, or `ac_confirmation_status` was
set to `blocked`.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts diagnose {ledger} --json
```

**JSON fields to inspect.** `data.inferred_route_id`,
`data.drift.digest_drift.acceptance_criteria`,
`data.blocking_gates`.

**What the fields prove.** Both cases share `inferred_route_id:
"blocked-acceptance-criteria-stale"`, but the proof differs by case, and the
two are mutually exclusive in the drift field:

- **Stale digest (AC edited after confirmation).**
  `drift.digest_drift.acceptance_criteria: true` proves the stored
  `ac_digest` no longer matches the `## Acceptance criteria` content. Drift
  is computed only from the `stale` axis, so this boolean is the evidence
  here.
- **Blocked status (`ac_confirmation_status: blocked`).**
  `drift.digest_drift.acceptance_criteria` is `false` for this case (a
  blocked status is not a digest mismatch). The evidence is instead a
  `blocking_gates` entry `{kind: "field", field: "ac_confirmation_status",
  value: "blocked"}`. If you see the blocked route with no AC digest drift,
  read the field gate, not the drift boolean.

**Recovery / next.** Return to Stage 1 and re-confirm the AC list with the
user. Do not auto-rewrite ACs. After re-confirmation, recompute `ac_digest`
via `decompose.ts --ac-digest {ledger}` in the same checkpoint. See
[stage-1-pick-issue.md](stage-1-pick-issue.md).

**Model note.** ACs are read-only after Stage 1 confirmation. Any later edit
breaks the digest anchor on purpose, so a human re-confirms before the run
commits more work against criteria that moved.

**Owner:** `gotchas guide`.
**Retire when** the `blocked-acceptance-criteria-stale` bullet in the
`SKILL.md` `<route_catalog>` block points to this recipe by name (a
per-route link, not the generic blocked-route paragraph that already exists
below those bullets).

### 2.2 `blocked-batch-contract-stale`

**Symptom / route id.** `route_id: "blocked-batch-contract-stale"`. The
confirmed `## Batches` content drifted from its stored digest. See Part 1.3
for the candidate-vs-ledger variant of this symptom.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts diagnose {ledger} --json
```

**JSON fields to inspect.** `data.inferred_route_id`,
`data.drift.digest_drift.batch_contract`, `data.blocking_gates`.

**What the fields prove.** `inferred_route_id:
"blocked-batch-contract-stale"` with
`drift.digest_drift.batch_contract: true` proves the stored
`batch_contract_digest` no longer matches the `## Batches` content.

**Recovery / next.** Return to Stage 3, recompute the batch contract digest,
re-present the contract, and get user confirmation before resuming Stage 4.
See [stage-3-decompose.md](stage-3-decompose.md).

**Model note.** The batch contract is immutable after confirmation. Drift on
the immutable fields means the plan-of-record changed, which requires a fresh
human confirmation before Builders run against it.

**Owner:** `gotchas guide`.
**Retire when** the `blocked-batch-contract-stale` bullet in the `SKILL.md`
`<route_catalog>` block points to this recipe by name (a per-route link, not
the generic blocked-route paragraph that already exists below those
bullets).

### 2.3 `blocked-digests-stale`

**Symptom / route id.** `route_id: "blocked-digests-stale"`. In practice this
route is reached by `plan_digest` drift: an `ac_digest` mismatch makes
`acceptance_criteria` go `stale` and routes to
`blocked-acceptance-criteria-stale` first, and a `batch_contract_digest`
mismatch routes to `blocked-batch-contract-stale` first (route precedence in
`lib/route.ts` `classifyRoute` checks both before digests-stale). So if you
are on `blocked-digests-stale` with AC and batch contract both still
confirmed, the drifted digest is the plan digest.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts diagnose {ledger} --json
```

**JSON fields to inspect.** `data.inferred_route_id`,
`data.drift.digest_drift.{acceptance_criteria, batch_contract, digests,
any}`.

**What the fields prove.** `inferred_route_id: "blocked-digests-stale"`
with `drift.digest_drift.any: true` proves at least one digest drifted. The
per-axis booleans tell you which source content moved; on this route, with
AC and batch contract confirmed, expect the plan digest to be the drifted
one.

**Recovery / next.** Return to Stage 3, recompute the drifted digest(s) over
the current source content, and get user re-confirmation. Do not flip
confirmation statuses by hand to "clear" the route. See
[stage-3-decompose.md](stage-3-decompose.md) and
[ledger-and-helper.md](ledger-and-helper.md#helper-execution-context).

**Model note.** This route is the lowest-precedence stale gate (route.ts
`classifyRoute` checks `blocked-acceptance-criteria-stale` and
`blocked-batch-contract-stale` before it). It catches digest drift that has
no more-specific gate of its own, notably plan-digest drift, so a mismatch
cannot slip through a stage transition unnoticed.

**Owner:** `gotchas guide`.
**Retire when** the stage-transition digest recheck in
[ledger-and-helper.md](ledger-and-helper.md#helper-execution-context)
links here for the recovery sequence.

### 2.4 `blocked-runbook-version-skew`

**Symptom / route id.** `route_id: "blocked-runbook-version-skew"`. The
ledger's `runbook_version` does not equal the runtime `RUNBOOK_VERSION`, or
the field is missing (a legacy ledger).

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json
```

**JSON fields to inspect.** `data.runbook_version` (verbatim ledger value or
null), `data.runbook_version_skew` (`matched | missing | mismatched |
continuation-evidence-present`), `data.blocking_gates`.

**What the fields prove.** A `runbook_version_skew` of `missing` or
`mismatched` with a `blocking_gates` entry `{kind: "field", field:
"frontmatter.runbook_version", value: "missing" | "mismatched"}` proves the
ledger was authored against a different contract version and the run is
fail-closed. Prefer `runbook_version_skew` over the back-compat
`version_skew` string, which defaults to `matched` for the no-ledger case.

**Recovery / next.** Do not auto-rewrite the frontmatter version. Either
update the ledger to the current version deliberately, or author a complete
continuation-evidence row in `## Notes` for the current runtime version. The
continuation-evidence YAML shape and its required fields live in
[ledger-and-helper.md](ledger-and-helper.md#continuation-evidence-shape-u6).
A `continuation-evidence-present` skew suppresses this route and routing
falls through to the happy path.

**Model note.** A bumped `RUNBOOK_VERSION` is a deliberate contract change.
The gate stops a run from dispatching packets rendered against a contract the
runbook no longer honors, until a human records the carry-forward decision.

**Owner:** `gotchas guide`.
**Retire when** the version-skew entry in the `SKILL.md` `<pre_route_gates>`
block points to this recipe by name (it currently links only to
`ledger-and-helper.md` for the continuation-evidence shape).

### 2.5 Install-presence block: `installed_artifact_presence.all_present: false`

**Symptom / route id.** The pre-route install gate stops the run before any
route catalog entry. This gate is reported as a sibling field, not
necessarily as a `blocking_gates` entry or a blocked `route_id`, so do not
route from those fields alone.

**Command.**

```
bun runbooks/issue-to-pr-v2/cli.ts state {ledger} --json
bun runbooks/issue-to-pr-v2/cli.ts diagnose {ledger} --json
```

**JSON fields to inspect.**
`data.installed_artifact_presence.{references, templates, cli_ts, lib_dir,
all_present, missing}`.

**What the fields prove.** `all_present: false` proves part of the v2 install
is missing. The `missing` array names which installed roots are absent (any
of `references`, `templates`, `cli_ts`, `lib_dir`).

**Recovery / next.** Stop. Repair the v2 install or symlink so every root is
present, then re-run `state --json` and confirm `all_present: true` before
continuing. This is an environment repair, not a ledger edit. See the
install topology in the workflow [README](../README.md#file-map).

**Model note.** The orchestrator routes off install-presence as a sibling
field precisely because a partial install can leave `route_id` and
`blocking_gates` looking healthy while the references or CLI the run depends
on are absent. Checking `all_present` first fails closed on a broken
environment.

**Owner:** `gotchas guide`.
**Retire when** `SKILL.md`'s installed-artifact-presence pre-route gate links
here for the repair steps.

---

## See also

- [ledger-and-helper.md](ledger-and-helper.md) for the ledger schema, route
  catalog, precedence order, and digest recompute context.
- [stage-1-pick-issue.md](stage-1-pick-issue.md) for AC confirmation.
- [stage-3-decompose.md](stage-3-decompose.md) for batch contract and digest
  recompute.
- [findings-and-validators.md](findings-and-validators.md) for findings shape
  and closure rules.
- [`SKILL.md`](../../../skills/issue-to-pr/SKILL.md) for the control-plane
  route catalog and pre-route gates.
