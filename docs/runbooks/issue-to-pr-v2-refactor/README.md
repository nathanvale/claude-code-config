# Issue-to-PR V2 Refactor - Iterative Code Review Runbooks

Iterative review runbooks for the Issue-to-PR v2 refactor in `runbooks/issue-to-pr/`
(this repo). Each seam pins one slice of the v2 contract — coverage maps, packet
boundaries, ledger versioning, regression probes — and converges via repeated
sweeps until the seam's audit produces zero new findings.

Each runbook is driven by `/goal` with a short file-pointer condition. The runbook
is the source of truth; the goal just tells the agent to follow it until the
ledger is empty of open rows.

`/goal` requires Claude Code v2.1.139+. Older versions can use `/loop` as a
fallback.

## Why these seams

The v2 refactor (issue #48) lands as a set of tight contracts that the public
hot router cuts over to atomically. Each seam below is one of those contracts —
small enough to audit on a screen, with findings that stay inside the seam.

**Contract-shaped seams** (state machines, types, documented behaviour):

| Seam | Runbook | Ledger | Files |
| --- | --- | --- | --- |
| V2 contract coverage | [v2-contract-coverage.md](v2-contract-coverage.md) | [v2-contract-coverage-ledger.md](v2-contract-coverage-ledger.md) | v1 sources: `runbooks/issue-to-pr/issue-to-pr.md`, `runbooks/issue-to-pr/README.md`, `runbooks/issue-to-pr/issue-N-ledger.template.md`, `runbooks/issue-to-pr/decompose.ts`; v2 matrix: `runbooks/issue-to-pr-v2/references/regression-matrix.md` |
| V2 shadow tree extraction | [v2-shadow-tree-extraction.md](v2-shadow-tree-extraction.md) | [v2-shadow-tree-extraction-ledger.md](v2-shadow-tree-extraction-ledger.md) | v2 shadow tree (writable): `runbooks/issue-to-pr-v2/references/*.md`, `runbooks/issue-to-pr-v2/templates/*.md`; v1 sources (read-only): `runbooks/issue-to-pr/`; U1 anchor (read-only): `runbooks/issue-to-pr-v2/references/regression-matrix.md` |
| V2 CLI front door | [u4-cli-front-door.md](u4-cli-front-door.md) | [u4-cli-front-door-ledger.md](u4-cli-front-door-ledger.md) | Writable: `runbooks/issue-to-pr-v2/cli.ts`, `runbooks/issue-to-pr-v2/cli.test.ts`, `runbooks/issue-to-pr-v2/lib/cli-envelope.ts`, `runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts`, `runbooks/issue-to-pr-v2/lib/route.ts`, their `*.test.ts`, plus targeted edits to `runbooks/issue-to-pr-v2/lib/ledger.ts` (fail-mode toggle) and `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (route id catalog). Read-only: v1 sources, U3 helper internals, U2 shadow references not named writable, U1 matrix |
| V2 packet rendering | [u5-packet-rendering.md](u5-packet-rendering.md) | [u5-packet-rendering-ledger.md](u5-packet-rendering-ledger.md) | Writable: `runbooks/issue-to-pr-v2/lib/packets.ts` + tests, additive packet subcommands in `runbooks/issue-to-pr-v2/cli.ts` + tests, the five role templates under `runbooks/issue-to-pr-v2/templates/`, plus targeted edits to `runbooks/issue-to-pr-v2/references/builder-dispatch.md` and `runbooks/issue-to-pr-v2/references/findings-and-validators.md` (placeholder syntax). Read-only: v1 sources, U3 helper internals beyond the packet rendering needs, U4 envelope contracts (forward-compatible), U1 matrix, U6 runbook_version territory |

**Cross-cutting seams** (each spans many files):

*(none yet — future units U5/U6/U9 may add cross-cutting seams as they land)*

## Invocation

Pick the seam, then run the file-pointer goal below. The runbook does the rest.

### V2 contract coverage

```
/goal Follow docs/runbooks/issue-to-pr-v2-refactor/v2-contract-coverage.md.
Re-read the runbook and v2-contract-coverage-ledger.md at the start of every
turn. Drive every ledger row to status fixed or closed and the most recent
/ce-code-review pass to zero new findings. Echo the full ledger status table
inline at the end of every turn. Stop after 30 turns.
```

### V2 shadow tree extraction

```
/goal Follow docs/runbooks/issue-to-pr-v2-refactor/v2-shadow-tree-extraction.md.
Re-read the runbook and v2-shadow-tree-extraction-ledger.md at the start of every
turn. Drive every ledger row to status fixed or closed and the most recent
/ce-code-review pass to zero new findings. Echo the full ledger status table
inline at the end of every turn. Stop after 30 turns.
```

### V2 CLI front door

```
/goal Follow docs/runbooks/issue-to-pr-v2-refactor/u4-cli-front-door.md.
Re-read the runbook and u4-cli-front-door-ledger.md at the start of every
turn. Drive every ledger row to status fixed or closed and the most recent
/ce-code-review pass to zero new findings. Echo the full ledger status table
inline at the end of every turn. Stop after 30 turns.
```

### V2 packet rendering

```
/goal Follow docs/runbooks/issue-to-pr-v2-refactor/u5-packet-rendering.md.
Re-read the runbook and u5-packet-rendering-ledger.md at the start of every
turn. Drive every ledger row to status fixed or closed and the most recent
/ce-code-review pass to zero new findings. Echo the full ledger status table
inline at the end of every turn. Stop after 30 turns.
```

## Driver: /goal vs /loop

| | `/goal` (preferred) | `/loop` (fallback) |
| --- | --- | --- |
| Re-fire trigger | Previous turn finishes | Time interval elapses |
| Stop condition | Evaluator model confirms condition holds | You stop it, or agent decides |
| Verifies via | Conversation transcript only | Same |
| Min version | Claude Code v2.1.139+ | Any |

`/goal`'s evaluator (a small fast model, Haiku by default) reads only the
**conversation transcript**, not the filesystem. So every runbook is designed
so the agent **echoes the ledger status table inline at the end of each turn**.

## Turn protocol (shared)

Each seam runbook defines:

1. Files in scope
2. Suggested reviewer personas (passed to `/ce-code-review` to spawn in parallel)
3. The scoped audit prompt for `/ce-code-review`
4. Seam-specific ADR guardrails

The shared protocol every runbook follows:

1. Read the runbook and the seam's ledger fresh
2. Run `/ce-code-review` with the scoped audit prompt and suggested personas
3. For each finding, compute a stable kebab-case signature
4. Dedupe against the ledger (fixed/closed → drop; open match → leave; else insert new open row)
5. Classify each open finding `low` | `high` per the risk policy below
6. For `high`: pause and ask the user
7. Apply the [Fix protocol](#fix-protocol-shared) to the approved queue
8. Re-run `/ce-code-review` and repeat dedupe
9. Echo the full ledger status table inline at the end of every turn

Stop condition: every ledger row is `fixed` or `closed`, and the most recent
`/ce-code-review` pass reports zero new findings.

## Fix protocol (shared)

For each open finding:

1. Confirm the signature is not already `fixed` or `closed` in the ledger.
2. If the risk is `high`, stop and ask Nathan before editing.
3. If the risk is `low`, make the smallest contract edit to
   `runbooks/issue-to-pr-v2/references/regression-matrix.md` that resolves the
   finding. Keep v1 sources and v2 implementation artifacts read-only while
   running the U1 contract coverage seam.
4. Update the ledger row with `status: fixed` or `status: closed` and a concise
   resolution. Ledger bookkeeping and convergence notes are allowed; use
   `closed` only when the runbook's close reasons apply.
5. Re-read the changed matrix row against the v1 source before marking the row
   resolved. Source anchors, owner unit, and v2 destination must all agree with
   issue #48's unit plan.
6. Re-run the scoped review loop. New findings get new stable signatures; repeat
   until every row is `fixed` or `closed` and the most recent review pass reports
   zero new findings.

## Risk classification (auto-fix gate)

**Low risk - auto-fix without asking:**

- Adding a missing row to `runbooks/issue-to-pr-v2/references/regression-matrix.md` (additive only)
- Typos, formatting, copy edits, source-range clarifications, or destination
  clarifications inside `runbooks/issue-to-pr-v2/references/regression-matrix.md`
- Ledger bookkeeping that records, fixes, closes, or summarizes findings already
  produced by the U1 review loop

**High risk - pause and ask:**

- Any change to `runbooks/issue-to-pr/issue-to-pr.md` (the public hot runbook — frozen until U7 cutover)
- Any contract-content change outside
  `runbooks/issue-to-pr-v2/references/regression-matrix.md` while running the U1
  contract coverage seam
- Any change to `decompose.ts` runtime contract values (allowed statuses, schema keys, runbook_version)
- Any change to the ledger template's schema
- Anything that contradicts ADR 0001 or ADR 0002

## Ledger format

Each seam has its own ledger file. One row per finding. Status moves
`open → fixed | closed`. A finding's `signature` is what dedupe matches on
across passes — keep it stable.

```markdown
| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
```

## Suggested execution order

1. V2 contract coverage  *(U1 — must land before U2-U9 so later seams have a coverage map to extend)*
2. V2 shadow tree extraction  *(U2 — depends on U1 matrix being stable; must land before U7 public cutover so the hot router has somewhere to point)*

Future seams from issue #48's unit DAG may slot in here as they're stubbed:
U5 packet boundaries, U6 ledger versioning, U9 regression probes, U7 public cutover.

## Closing reports

When a seam converges, run:

```
/runbook-orchestrator report docs/runbooks/issue-to-pr-v2-refactor <seam>
```

This generates `<seam>-report-<YYYY-MM-DD>.md` with a ledger summary, a
files-touched list, and a tightness assessment via the
`improve-codebase-architecture` skill.

## Parallel execution

Do **not** run multiple runbooks concurrently in the same checkout — the fix
steps will collide on shared files. Either:

- Run them sequentially in a single checkout
- Use separate worktrees (`compound-engineering:ce-worktree`)
