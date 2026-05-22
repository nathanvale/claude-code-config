# Runbook: V2 runbook versioning and install topology checks (U6)

**Seam:** A runtime contract value `RUNBOOK_VERSION` in
`runbooks/issue-to-pr-v2/lib/contract.ts`, frontmatter `runbook_version`
on the v2 ledger template, version-skew detection in
`readLedgerSnapshot`, override-evidence parsing from `## Notes`, a real
recursive install-artifact presence walk in `lib/route.ts`, and CLI
surfacing through `cli.ts state` and `cli.ts diagnose`. The hot router
(U7) reads `runbook_version_skew` plus `installed_artifact_presence`
and refuses to dispatch when either is broken without continuation
evidence.

**Central risk: silent skew.** A resumed run that loads an old or
missing-version ledger under the new v2 runtime will route off a
contract the runbook no longer honors. A missing installed reference
or template will let the orchestrator dispatch a packet that points at
files that do not exist on the consumer machine. Both failures are
silent until they corrupt state. U6 fails closed at the CLI before
dispatch.

**Ledger:** [u6-runbook-version-ledger.md](u6-runbook-version-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/lib/contract.ts` (add `RUNBOOK_VERSION`
  constant + type)
- `runbooks/issue-to-pr-v2/lib/contract.test.ts` (test the constant
  export)
- `runbooks/issue-to-pr-v2/lib/ledger.ts` (extend `LedgerSnapshot` with
  `runbook_version`, derive `runbook_version_skew`, parse `## Notes`
  for continuation evidence rows)
- `runbooks/issue-to-pr-v2/lib/ledger.test.ts` (matching / missing /
  mismatched / continuation-evidence cases)
- `runbooks/issue-to-pr-v2/lib/route.ts` (real `installedArtifactPresence`
  recursive walk; surface `runbook_version_skew` blocking gate)
- `runbooks/issue-to-pr-v2/lib/route.test.ts` (presence + gate tests)
- `runbooks/issue-to-pr-v2/cli.ts` (surface `runbook_version`,
  `runbook_version_skew`, `installed_artifact_presence` shape on state
  + diagnose; add new error code for `version-skew-stop-required`)
- `runbooks/issue-to-pr-v2/cli.test.ts` (matching / missing /
  mismatched / continuation cases through the CLI surface)
- `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` (new; copy v1
  template + `runbook_version: 2` frontmatter field + Notes evidence
  documentation)
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (modify:
  document the continuation evidence shape and the version-skew
  blocking semantics; do not restate U2 prose)
- `runbooks/issue-to-pr-v2/references/host-adapters.md` (modify:
  document the install-artifact presence contract; do not restate U2
  prose)
- `install.sh` (extend `--status` to verify recursive
  `runbooks/issue-to-pr-v2/` artifact presence through the installed
  symlink path)

**Read-only (U2/U3/U4/U5 surface — preserve except where named writable):**

- `runbooks/issue-to-pr-v2/lib/cli-envelope.ts`
- `runbooks/issue-to-pr-v2/lib/cli-diagnostics.ts`
- `runbooks/issue-to-pr-v2/lib/digest.ts`
- `runbooks/issue-to-pr-v2/lib/packets.ts` (U5 surface; do NOT add new
  exports unless the audit proves they're necessary)
- `runbooks/issue-to-pr-v2/lib/packets.test.ts`
- `runbooks/issue-to-pr-v2/decompose.ts`
- All `runbooks/issue-to-pr-v2/templates/*.md`
- All `runbooks/issue-to-pr-v2/references/*.md` not named writable above

**Read-only (v1 sources — frozen until U7):**

- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/README.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (anchors — this seam consumes them):**

- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 anchor)

## What U6 is NOT — explicit anti-list

These belong to other units and must not be implemented here:

- **Hot router wiring (U7 territory).** U6 exposes
  `runbook_version_skew` and `installed_artifact_presence` as facts on
  the CLI surface; *when* the orchestrator stops, *what* it tells the
  user, and the resumed-turn routing are U7 prose concerns. U6 ships
  the detection; U7 wires it.
- **LogTape integration / AsyncLocalStorage (U7).** U6 stays on
  `emitDiagnostic`.
- **Real Notes-evidence WRITES (U7's responsibility once the hot
  router is in place).** U6 *parses* Notes for continuation evidence
  and surfaces it on the snapshot; the orchestrator and user write the
  evidence row via the v2 ledger template. The CLI remains read-only
  per ADR 0002 / R-no-orchestrator-CLI.
- **Migrating live v1 ledgers under `runbooks/issue-to-pr/`.** Those
  remain v1 and frozen. The v2 ledger template is brand-new.
- **Regression probes (U9).** U6 lands the detection; U9 lands the
  probes that *exercise* that detection.
- **Public hot router cutover (U7).** U6 must not edit
  `runbooks/issue-to-pr/issue-to-pr.md`.

## Suggested reviewer personas

Always-on (every sweep):

- `compound-engineering:ce-correctness-reviewer` — does
  `readLedgerSnapshot` correctly classify each of the five cases
  (matching / missing / mismatched / continuation-evidence-present /
  v2-but-no-evidence)? Does `installedArtifactPresence` return false
  for any genuinely missing path?
- `compound-engineering:ce-api-contract-reviewer` — does
  `runbook_version_skew` use the same enum as the existing
  `LedgerSnapshot.runbook_version_skew` type
  (`matched | missing | mismatched | continuation-evidence-present`)?
  Is the help catalog updated? Does the envelope schema_version stay
  `1` (additive only)?
- `compound-engineering:ce-scope-guardian-reviewer` — does the diff
  respect the U6 anti-list (no router wiring, no LogTape, no v1 edits,
  no live-ledger migration)?
- `compound-engineering:ce-testing-reviewer` — are all five AC cases
  tested through both the lib surface AND the CLI surface? Is the
  continuation-evidence parser tested against malformed and
  partial-evidence inputs?
- `compound-engineering:ce-security-sentinel` — can a hostile Notes
  line forge continuation evidence (e.g., a comment block that
  *looks* like an evidence row but isn't operator-recorded)? Can a
  symlink loop in the install path cause unbounded recursion in
  `installedArtifactPresence`?

Conditional:

- `compound-engineering:ce-kieran-typescript-reviewer` — added when
  the `lib/ledger.ts` diff grows beyond ~150 lines, since
  `LedgerSnapshot` is a load-bearing typed export.

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split)** — version-skew
  detection is mechanical; the orchestrator decides *how to ask*. A
  CLI field named `recommended_user_message` or `next_action` is a P0.
- **ADR 0002 (CLI emits facts, not orchestration)** — U6 adds
  `runbook_version`, `runbook_version_skew`,
  `installed_artifact_presence` to the snapshot. All are facts.
- **R-no-orchestrator-CLI** — the CLI does not write the continuation
  evidence row. U6 ships the *parser* for the documented evidence
  shape; the orchestrator + user write the row through normal ledger
  authoring.
- **R3 (lib/* module split)** — install topology lives in
  `lib/route.ts` (alongside the existing
  `installedArtifactPresence` stub it replaces). Putting filesystem
  walks directly into the CLI dispatcher is P1.
- **R8 (deterministic from templates + ledger)** — same ledger + same
  filesystem state MUST yield identical snapshot output. Mtime,
  inode, or fs-order leakage is P1.
- **R10 (preserve U3/U4/U5 split)** — extend existing modules; no
  new exports added to U5's `lib/packets.ts` unless the audit proves
  them necessary.
- **R11 (runbook_version contract)** — version source of truth lives
  in `lib/contract.ts`. The ledger frontmatter stores the *run's*
  version. They MUST be compared as strings; no semver, no integer
  coercion.
- **R13 (explicit ledger evidence)** — continuation evidence has a
  documented shape (operator decision, timestamp, ledger version,
  runtime version, route/reference context, accepted risk). The
  parser MUST require every field; a missing field disqualifies the
  evidence.
- **No installed-copy install topology** — install.sh stays
  symlink-only. U6 must not introduce a `cp -r` install path.

## Per-snapshot contracts (MUST include / MUST NOT leak)

### `LedgerSnapshot.runbook_version`

**MUST include:**

- Verbatim string value from the ledger frontmatter
  `runbook_version` field, with no coercion.
- `null` when the frontmatter field is missing or empty.

**MUST NOT leak:**

- Any non-string value (no integer, no boolean, no array).
- Any error message (parse failures fall through to `null`).

### `LedgerSnapshot.runbook_version_skew`

**MUST include exactly one of:**

- `"matched"` — frontmatter value equals `RUNBOOK_VERSION` constant.
- `"missing"` — frontmatter has no `runbook_version` field at all
  (legacy v1 ledger).
- `"mismatched"` — frontmatter has a value but it does NOT equal
  `RUNBOOK_VERSION` (legacy v0, future v3, or a typo).
- `"continuation-evidence-present"` — skew detected (missing or
  mismatched) BUT a complete continuation evidence row exists in
  `## Notes` for the current runtime version.

**MUST NOT include:**

- `null` — when the ledger does not exist, the existing
  `readLedgerSnapshot` no-ledger path already returns `null`; U6
  preserves that.
- Any other string value.

### `installed_artifact_presence`

**MUST include:**

- A structured map of artifact roots → boolean presence:
  `{ references: bool, templates: bool, cli_ts: bool, lib_dir: bool }`
- An aggregate `all_present: bool` that is true iff every root is
  present.
- A `missing` array listing the roots that are absent, for
  diagnostic output.

**MUST NOT leak:**

- Any per-file enumeration (the orchestrator does not need a file
  list; presence at the root level is sufficient and avoids leaking
  unrelated repo contents).
- Filesystem paths outside `runbooks/issue-to-pr-v2/`.
- Symlink targets, inode numbers, mtimes.

### Continuation evidence row schema

Documented in `references/ledger-and-helper.md` and parsed by
`lib/ledger.ts`. A continuation evidence row appears in the `## Notes`
section as a fenced YAML block prefixed by `<!-- runbook-version-skew-continuation -->`:

```yaml
runbook_version_skew_continuation:
  ledger_version: "<value | null>"     # what the ledger says (or null)
  runtime_version: "<value>"            # the RUNBOOK_VERSION the run is using
  operator_decision: "<actor>"          # e.g. "Nathan @ 2026-05-22T19:00"
  timestamp: "<ISO 8601>"
  route_context: "<route id at the time of decision>"
  reference_context: "<reference file the operator consulted>"
  accepted_risk: "<one-line reason>"
```

**Every field is required.** A missing field disqualifies the evidence
and the snapshot reports the underlying `missing` or `mismatched`
skew.

## Scoped audit prompt

````
Review U6 runbook versioning + install topology in
`runbooks/issue-to-pr-v2/lib/contract.ts` (new `RUNBOOK_VERSION` export),
`runbooks/issue-to-pr-v2/lib/ledger.ts` (extended `LedgerSnapshot` +
Notes-evidence parser), `runbooks/issue-to-pr-v2/lib/route.ts` (real
`installedArtifactPresence`), `runbooks/issue-to-pr-v2/cli.ts` (state +
diagnose surfacing), the new
`runbooks/issue-to-pr-v2/issue-N-ledger.template.md`, the writable
references, and `install.sh --status`. Tests in `lib/ledger.test.ts`,
`lib/route.test.ts`, `cli.test.ts`, and `lib/contract.test.ts`.

Audit items:

1. Does `runbook_version_skew` classify exactly one of `matched |
   missing | mismatched | continuation-evidence-present` for every
   input?
2. Does the continuation-evidence parser require every documented field?
   Does it reject a row missing any field?
3. Does `installedArtifactPresence` correctly detect presence of each
   root (`references/`, `templates/`, `cli.ts`, `lib/`) through the
   installed symlink path? Does it return `all_present: false` if any
   root is missing?
4. Is `RUNBOOK_VERSION` the single source of truth (lib/contract.ts)?
   Is it compared as a string, not coerced?
5. Does the CLI surface (state + diagnose) emit the new fields
   additively (no breaking shape change to U4 envelope)?
6. Does the ledger template land `runbook_version: 2` in frontmatter?
   Is the Notes evidence schema documented?
7. Does install.sh --status verify recursive v2 artifact presence?
   Does it preserve the existing symlink-only topology?
8. Is the seam read-only (no ledger writes, no live v1 ledger
   migration, no router wiring)?
9. Can a hostile Notes line forge continuation evidence? Does the
   parser require the documented YAML envelope and every field?
10. Does the install-presence walk handle symlink loops or non-existent
    install paths without throwing?

Severity:
- P0: silent skew (no stop-required signal when version mismatch + no
  evidence), ledger mutation by the CLI, evidence parser accepts
  incomplete row, install-presence returns true for missing root,
  ADR 0001/0002 violation
- P1: U4 envelope schema drift, hidden non-determinism in snapshot,
  no comparison vs RUNBOOK_VERSION constant
- P2: missing test for one of the four skew states, missing
  continuation-evidence test, install.sh status drift
- P3: minor formatting

Return findings with stable kebab-case signatures (e.g.
`runbook-version-skew-missing-classified-as-matched`,
`continuation-evidence-parser-accepts-missing-field`,
`installed-presence-true-when-cli-ts-absent`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT
propose edits to U5 packet rendering internals. Do NOT propose
hot-router wiring (U7).
````

## Closing a finding without fixing it

Seam-specific close reasons:

- `not-in-u6-scope` — finding belongs to U7 (router wiring), U9
  (regression probes), or a future seam.
- `deferred-to-u7-router` — the orchestrator's user-facing message on
  stop-required skew is U7's prose responsibility.
- `deferred-to-u9-probes` — finding is about exercising the version
  skew or install presence detection in a regression probe.

## /loop fallback

```
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u6-runbook-version.md.
Re-read the runbook and u6-runbook-version-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every turn.
```
