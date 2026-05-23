# Issue to PR (v2 shadow install — human index)

Maintainer-facing index for the v2 shadow tree at
`runbooks/issue-to-pr-v2/`. The v2 install is in **shadow** until U9 cuts
over the public hot-router entry point. The runnable, public reference
remains the v1 install at `~/.claude/runbooks/issue-to-pr/` until that
cutover lands.

This README is a **finder**, not a workflow manual. Agents never read
this file: agents read the hot router at `issue-to-pr.md`, the per-stage
references, and the templates. Operators and maintainers read this file
only to land on the right artifact. Every detail below is a pointer —
the linked artifact owns the prose.

## Installed path

The v2 tree is installed via symlink at
`~/.claude/runbooks/issue-to-pr-v2/`, which resolves through
`~/.claude/runbooks → ${REPO}/runbooks` (see `install.sh`). Once a
ledger exists, `cli.ts state <ledger-path> --json` reports
`installed_artifact_presence.all_present` so the orchestrator can fail
closed on a partial install; the U6 contract for that envelope lives in
[`references/host-adapters.md`](references/host-adapters.md#install-artifact-presence-u6).

## Invocation

The hot router is the single entry point. Drive it with `/goal`:

```
/goal Follow ~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md.
Target issue is {issue-number} in {target-repo}.
Re-read the runbook AND the per-issue ledger at
docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md
at the start of every turn.
```

Inside the hot router, agents follow the
[Start every turn](issue-to-pr.md#start-every-turn) protocol; the hot
router owns turn protocol, fix protocol, and routing decisions. This
README does not duplicate that prose.

### Driver: /goal vs /loop

`/goal` (Claude Code v2.1.139+) is the preferred driver; `/loop` is the
fallback for older harnesses or fixed-cadence ticks. The shared
runbook-area README at
[`docs/runbooks/issue-to-pr-v2-refactor/README.md`](../../docs/runbooks/issue-to-pr-v2-refactor/README.md#driver-goal-vs-loop)
owns the comparison table — do not restate it here.

## Per-issue ledger

Each run writes a per-issue ledger in the target repo at
`docs/runbooks/issue-to-pr/issue-{issue-number}-ledger.md` (the path is
shared with v1). The orchestrator copies
`issue-N-ledger.template.md` on first turn. Ledger schema, frontmatter
fields, and the runbook-version skew table all live in
[`references/ledger-and-helper.md`](references/ledger-and-helper.md).

## File map

The artifacts a maintainer needs to find, in this order:

1. **`issue-to-pr.md`** — the v2 hot router (U7). The single
   orchestration entry point for agents. Owns the turn protocol, the
   stage shells, the pre-stage gates, the router state enumeration, and
   the fix-protocol prose.
2. **`cli.ts`** — the v2 read-only fact emitter (U4/U5/U6). One
   sentence per command:
   - `state` — emit the ledger's durable state for the hot router to
     route off.
   - `next` — emit the minimal next route id as a fact.
   - `contract` — emit a runtime contract slice from `lib/contract.ts`.
   - `diagnose` — emit a richer diagnostic envelope than `state` for
     debugging drift, version skew, and install presence.
   - `packet` — render a dispatch-role packet from `templates/` and
     ledger state.

   Every command requires `--json` and writes one envelope to stdout.
   The CLI is a fact emitter and never says "run X" (ADR 0002). For the
   full envelope contract run
   `bun ~/.claude/runbooks/issue-to-pr-v2/cli.ts --help --json`.
3. **`decompose.ts`** — the deterministic helper for plan parsing,
   digest computation, AC coverage, findings validation, and
   patch-proposal validation. Command families:
   - **Plan parsing** — parses an authored plan and emits a candidate
     batch DAG.
   - **Digest computation** — recomputes the plan, AC, and
     batch-contract digests recorded in ledger frontmatter.
   - **Validation** — pure checks for ledger batches, AC coverage,
     findings shape, open-finding closure gates, and confirmation
     state; each exits non-zero on a violation.
   - **Patch proposal** — validates a candidate patch-batch against
     existing ledger context.

   Run `bun ~/.claude/runbooks/issue-to-pr-v2/decompose.ts` with no
   arguments for the full flag listing; the helper enumerates its
   usage string in its error path.
4. **`lib/`** — implementation modules behind `cli.ts` and
   `decompose.ts`. One-line role per module:
   - `contract.ts` — runtime contract constants shared across the CLI
     and helper surfaces.
   - `cli-envelope.ts` — envelope shape and emitters used by `cli.ts`.
   - `cli-diagnostics.ts` — LogTape diagnostics, AsyncLocalStorage
     correlation, and redactor used by the CLI surface.
   - `ledger.ts` — ledger reader/parser and helper command bodies.
   - `digest.ts` — canonical hashing for the three stored digests.
   - `validate.ts` — shared validation predicates used by the CLI and
     helper.
   - `route.ts` — route classification and install-topology walk.
   - `packets.ts` — packet rendering against `templates/`.

   The public API of each module lives in the module itself; this
   README does not restate it.
5. **`references/`** — per-stage prose. The read trigger for each file
   lives in its own header; the hot router's reference-loading table
   names which file to open for each route id. Files in this directory:
   `stage-1-pick-issue.md`, `stage-2-plan.md`, `stage-3-decompose.md`,
   `stage-4-batch-loop.md`, `stage-5-final-review.md`,
   `stage-6-ship.md`, `builder-dispatch.md`,
   `findings-and-validators.md`, `host-adapters.md`,
   `ledger-and-helper.md`, `regression-matrix.md`.
6. **`templates/`** — packet templates rendered by `cli.ts packet`.
   Files: `builder-work-packet.md`, `builder-return-envelope.md`,
   `proposer-envelope.md`, `validator-envelope.md`,
   `patch-proposal.md`, `ce-plan-addendum.md`. The role each template
   serves is encoded in its filename; the validator persona model lives
   in
   [`references/findings-and-validators.md`](references/findings-and-validators.md).
7. **`issue-N-ledger.template.md`** — the U6 ledger template (see
   [Per-issue ledger](#per-issue-ledger) above).

## Helper execution context

Helpers are pure, read-only, and **must run from the target repo root**.
The full rule — including why running from an installed path or home
directory validates against the wrong git repository — lives in
[`references/ledger-and-helper.md#helper-execution-context`](references/ledger-and-helper.md#helper-execution-context).

- Use the MCP runners (`bun_runTests`, `tsc_check`, `biome_lintCheck`)
  where they fit; shell fallback is allowed when they don't. The
  resolution order lives in
  [`references/stage-6-ship.md`](references/stage-6-ship.md).

## Compatibility notes

- **v1 still runnable.** `~/.claude/runbooks/issue-to-pr/` remains the
  public, runnable reference until U9. U8 does not change any
  installation script, symlink, or v1 file.
- **Ledger path is shared with v1.** See [Per-issue
  ledger](#per-issue-ledger) above. The v1-vs-v2 skew rules live in
  [`references/ledger-and-helper.md`](references/ledger-and-helper.md).

## What this area deliberately does not do

This README is a finder. The owning artifact for each topic the v1
README used to cover inline:

- **Builder dispatch policy** lives in
  [`references/builder-dispatch.md`](references/builder-dispatch.md).
- **Turn protocol** lives in the v2 hot router at
  [`issue-to-pr.md`](issue-to-pr.md).
- **Fix protocol** lives in
  [`references/findings-and-validators.md`](references/findings-and-validators.md).
- **Risk classification** lives in
  [`references/findings-and-validators.md`](references/findings-and-validators.md).
- **Ledger schema** lives in
  [`references/ledger-and-helper.md`](references/ledger-and-helper.md)
  and `issue-N-ledger.template.md`.
- **Glossary terms** live in each owning artifact (no central
  glossary).
- **Persona selector and broad-reviewer fallback** live in
  [`references/findings-and-validators.md`](references/findings-and-validators.md).
- **Host-readiness and Builder infrastructure failure modes** live in
  [`references/host-adapters.md`](references/host-adapters.md).
- **Per-stage detail** (pick-issue, plan, decompose, batch-loop,
  final-review, ship) lives in the matching
  `references/stage-*-*.md` file.

## See also

- [v1 install](../issue-to-pr/) — runnable until U9 cutover.
- [Refactor runbook area](../../docs/runbooks/issue-to-pr-v2-refactor/) —
  seam runbooks and ledgers that drove this install.
- [U8 seam runbook](../../docs/runbooks/issue-to-pr-v2-refactor/u8-readme.md)
  — the spec this README satisfies.
