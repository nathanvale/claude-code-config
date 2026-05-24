---
title: "feat: Add runtime contract drift check for Issue-to-PR operator-facing docs"
type: feat
status: active
created: 2026-05-24
issue: 81
issue_url: "https://github.com/nathanvale/claude-code-config/issues/81"
target_repo: nathanvale/claude-code-config
---

# feat: Add runtime contract drift check for Issue-to-PR operator-facing docs

## Problem Frame

The Issue-to-PR v2 CLI (`runbooks/issue-to-pr-v2/cli.ts`) emits a runtime
contract: route IDs, command names, contract slice names, packet roles, and
documented `data.*` response-field shapes. Four operator-facing documents
quote that contract in prose:

- `skills/issue-to-pr/SKILL.md` (skill control plane)
- `runbooks/issue-to-pr-v2/README.md` (human index)
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md`
- `runbooks/issue-to-pr-v2/references/first-run-gotchas.md`

When the contract changes (a route ID renamed, a command removed, a response
field restructured), these docs silently drift. An operator following a stale
recovery recipe runs a command that no longer exists or inspects a JSON field
that was renamed, at the exact moment they are already confused. Nothing
catches this today.

This plan adds a **focused runtime contract drift check**: a read-only script
plus tests that compares the contract-facts these four docs quote against the
facts the live CLI emits. The check derives its expected values *from the CLI
at runtime* rather than from hardcoded duplicate lists, so it cannot itself
become a second source of truth that drifts.

---

## Scope Boundaries

### In scope

- A read-only check that validates, against the live CLI runtime contract:
  - quoted route IDs in the four scoped docs (vs `cli.ts contract route_ids --json`)
  - mentioned `cli.ts` command names and contract slice names (vs `cli.ts --help --json` and `cli.ts contract <slice> --json`)
  - packet roles only when docs mention them in explicit `cli.ts packet <role>` command positions (vs `cli.ts contract packet_roles --json` / `--help --json`)
  - explicit `data.*` response-field paths used by the scoped docs (vs the documented `state_response_shape` / `diagnose_response_shape` in `--help --json`)
  - the recovery/control-plane links the scope needs, especially the deterministic first-run gotchas guide relationship
- Tests, including at least one fake stale-doc claim proving the check fails on a real mismatch.

### Non-goals (Outside this issue's identity)

- Broad documentation consistency or a general docs audit.
- All Issue-to-PR references (only the four scoped surfaces are protected).
- Prose truth judgments (whether a sentence is *correct*, only whether the
  contract tokens it names *exist*).
- New CLI observability or new emitted facts.
- Generated docs.
- New dependencies (bun stdlib + the existing CLI only).
- A general markdown link crawler (only the scoped recovery/control-plane links).
- `decompose.ts` flags, helper output, route-precedence order, enum-value
  prose, template filenames, or role-ish workflow words such as "builder" and
  "validator" outside explicit `cli.ts packet <role>` command positions.
- Negative checks that a reference is absent from CLI output; this check proves
  required relationships exist, not that unrelated relationships do not.

### Deferred to Follow-Up Work

- Extending the same check to the remaining Issue-to-PR references
  (`stage-*.md`, `findings-and-validators.md`, etc.) if drift there becomes a
  recurring problem.
- Wiring the check into a CI workflow / pre-commit gate (this plan delivers
  the check and its tests; CI integration is a separate decision).

---

## Key Technical Decisions

1. **Derive expected contract values from the CLI at runtime, never hardcode them.**
   The check shells out to the existing CLI (`bun cli.ts --help --json`,
   `cli.ts contract route_ids --json`, `cli.ts contract <slice> --json`) and
   treats the emitted `data.*` arrays as the authoritative set. This directly
   satisfies AC5 (no duplicate source-of-truth lists) and AC1/AC2/AC3 (validate
   against the CLI). The check holds *zero* literal route IDs, slice names,
   packet roles, or field paths as its own expectations.
   Use subprocess calls, not direct imports or in-process `run()` calls, so the
   loader validates the same command surface operators read and copy.

2. **Place the check beside the runtime it protects.**
   New file `runbooks/issue-to-pr-v2/contract-drift.ts` with colocated
   `contract-drift.test.ts`, matching the existing `cli.ts` / `cli.test.ts`,
   `decompose.ts` / `decompose.test.ts` layout. The check is a library module
   with a thin runnable entry, so tests can call its functions directly without
   spawning a subprocess for every assertion.

3. **Extract claims from docs with bounded, explicit patterns, not a generic crawler.**
   The check reads each scoped doc as text and extracts only the specific token
   *kinds* the contract owns. It scans all text, including fenced code blocks,
   because command examples and recovery recipes are high-risk operator
   surfaces:
   - route IDs: tokens matching the known route-ID lexical shape
     (kebab-case, including the `blocked-` family) that appear in
     code spans / quoted positions, then filtered to those the docs actually
     present *as route IDs* (e.g. ``route_id: "..."``, route tables, route
     headings, route catalog bullets). The candidate set is matched against
     the CLI's emitted list; a doc token claiming to be a route ID that is
     absent from the CLI list is drift.
   - `cli.ts` command names: tokens in `cli.ts <command>` / `cli.ts <command>
     ... --json` positions, plus the README's explicit `cli.ts` command-list
     section, matched against `data.commands[].name`.
   - contract slice names: tokens in `cli.ts contract <slice>` positions,
     matched against `data.contract_slices`.
   - packet roles: tokens in `cli.ts packet <role>` command positions,
     matched against `data.packet_roles` / `cli.ts contract packet_roles --json`;
     do not infer packet-role claims from template filenames, prose nouns, or
     role-ish workflow vocabulary.
   - `data.*` field paths: tokens matching `data.<dotted.path>` (with
     `{a, b, c}` brace-expansion sets flattened, including across line breaks),
     matched against the documented response-shape keys for `state` and
     `diagnose`. Bare field names are not claims except in explicit route-ID
     positions.
   - scoped links: markdown links whose target is a control-plane / recovery
     doc this scope cares about (especially `first-run-gotchas.md`), checked
     for target existence and, for the gotchas guide, that the linking
     relationship the workflow relies on is present.

   The intent is *contract-token verification*, not "scan every word." Patterns
   are deliberately narrow so the check stays a drift detector, not a linter.

4. **Tolerate documentation placeholders and schema-shorthand.**
   Docs legitimately write `cli.ts contract <slice> --json` and
   `data.confirmation_state.{acceptance_criteria, batch_contract, digests}`.
   The extractor must treat `<slice>` / `<role>` / `<ledger-path>` angle-bracket
   placeholders as non-claims (skip them) and expand `{a, b, c}` brace sets into
   individual field paths before comparison. This prevents false positives that
   would make the check untrustworthy.

5. **Flatten only finite nested response paths from existing CLI help.**
   The CLI currently exposes nested response-shape details in bounded
   descriptions under `state_response_shape` and `diagnose_response_shape`.
   The check should flatten nested `data.*` paths only when the help payload
   advertises a finite child set clearly enough to derive mechanically (for
   example `{ acceptance_criteria, batch_contract, digests }` or a `same shape
   as state_response_shape.digest_drift` reference). If a nested shape is not
   finite or not machine-derivable from existing help, validate only the nearest
   known parent path. Do not add a new CLI field-path slice for this issue.

6. **Match contract tokens exactly after trimming wrappers.**
   Trim surrounding quotes, backticks, punctuation, and whitespace, but do not
   lowercase or otherwise normalize the claim token. Contract tokens are
   machine-facing names: `Blocked-Stage-3` and `data.Route_ID` should fail.
   Markdown link target resolution may use normal path resolution, but the
   target text itself is not a case-insensitive contract token.

7. **Check the first-run gotchas relationship, not per-recipe deep links.**
   AC4 is satisfied when:
   - `SKILL.md` contains the deterministic control-plane load of
     `runbooks/issue-to-pr-v2/references/first-run-gotchas.md` for
     `blocked-` routes.
   - `ledger-and-helper.md` links from its route-id / blocked-route section to
     `first-run-gotchas.md`.
   - any markdown link to `first-run-gotchas.md` in the four scoped docs
     resolves to an existing file.

   Do not require the CLI to emit `first-run-gotchas.md` in
   `data.required_reference_ids`; that absence is intentional. Do not require
   each blocked-route bullet to deep-link to its exact recipe heading yet; the
   gotchas guide names those as retirement triggers, not current contract.

8. **Treat missing protected docs and failed CLI loads as hard errors.**
   A missing scoped doc means the check cannot evaluate its promised surface, so
   fail loudly instead of reporting an ordinary drift finding. Likewise, if a
   CLI subprocess fails or returns an error envelope, the loader should throw a
   clear error rather than yielding an empty fact set. Drift findings are for
   stale claims in readable docs; hard errors are for the check's own evidence
   source being unavailable.

9. **Read-only and side-effect-free.**
   The check never writes files, never mutates ledger state, never runs git
   mutations. It only reads the four docs and invokes the read-only CLI. This
   satisfies AC6.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for
review, not implementation specification. The implementing agent should treat
it as context, not code to reproduce.*

```text
contract-drift.ts
  ├─ loadContractFacts()                  ← invokes existing CLI, returns:
  │     { routeIds[], commandNames[], contractSlices[],
  │       packetRoles[], responseFieldPaths{state[], diagnose[]} }
  │
  ├─ extractDocClaims(docText, docPath)   ← bounded patterns, returns:
  │     { routeIdClaims[], commandClaims[], sliceClaims[], packetRoleClaims[],
  │       fieldPathClaims[], scopedLinkClaims[] }
  │     (placeholders skipped, brace-sets expanded)
  │
  ├─ compareClaimsToFacts(claims, facts)  ← per-doc, returns DriftFinding[]
  │     each finding: { doc, kind, claim, reason }
  │
  └─ checkContractDrift(opts?)            ← orchestrates over the 4 scoped docs,
        returns { ok: boolean, findings: DriftFinding[] }
        thin CLI entry prints findings + exits non-zero when !ok
```

The four scoped doc paths are the only structural constant the check holds
(they define *what to protect*, which is the issue's scope, not a contract
fact). Everything compared *against* comes from the CLI at runtime.

---

## Implementation Units

### U1. Contract-fact loader (read expected values from the live CLI)

**Goal:** Provide a function that returns the authoritative contract facts by
invoking the existing read-only CLI, so no expected values are hardcoded.

**Requirements:** Advances AC1, AC2, AC3, AC5, AC6.

**Dependencies:** none.

**Files:**
- `runbooks/issue-to-pr-v2/contract-drift.ts` (new — `loadContractFacts`)
- `runbooks/issue-to-pr-v2/contract-drift.test.ts` (new)

**Approach:** Shell out to the existing CLI via `bun` subprocess. Do not import
contract constants and do not call the exported `run()` in-process for the
loader path; this check protects the operator-facing command surface. Invoke
`--help --json`, `contract route_ids --json`, and `contract <slice> --json` so
the check validates the *same surface operators read*. Parse the success
envelope `data` to collect: `route_ids` (from `contract route_ids --json`),
`commands[].name`, `contract_slices`, `packet_roles`, and the documented
response-shape key sets from `state_response_shape` and
`diagnose_response_shape` (`--help --json`). Flatten only finite nested
response-shape paths that are mechanically derivable from the existing help
payload; otherwise keep only the nearest known parent path. Hold none of these
as literals in the check source.

**Patterns to follow:** Envelope parsing mirrors how `cli.test.ts` reads
`JSON.parse(stdout)` and asserts on `data`. Subprocess invocation should use
the repo-relative CLI path resolved from the module location.

**Test scenarios:**
- Happy path: `loadContractFacts()` returns a non-empty `routeIds` array whose
  contents equal `cli.ts contract route_ids --json` `data.values` (asserted by
  calling the CLI in the test and comparing, not by hardcoding the list).
- `commandNames` contains the live command set (e.g. includes `state`,
  `contract`) sourced from `--help --json`, asserted against a second live CLI
  call rather than a literal list.
- `packetRoles` equals the live `cli.ts contract packet_roles --json`
  `data.values`, asserted by calling the CLI rather than hardcoding role names.
- `responseFieldPaths.state` includes representative documented paths derived
  from `state_response_shape` keys (e.g. `data.route_id`,
  `data.confirmation_state.acceptance_criteria`), again sourced from the live
  CLI in the test; finite nested shapes are flattened, while non-finite shapes
  stop at the nearest known parent path.
- Error path: if the CLI invocation fails or returns an error envelope, the
  loader throws a clear error rather than silently yielding empty facts
  (an empty fact set would make every doc claim look like drift OR mask real
  drift — fail loud).

**Verification:** The loader reflects the live CLI surface and holds no literal
contract values; a reviewer can confirm by grepping the check source for
hardcoded route IDs, slice names, packet roles, or field paths and finding no
duplicate source-of-truth lists.

---

### U2. Doc-claim extractor (bounded contract-token patterns)

**Goal:** Extract only contract-token claims (route IDs, command names, slice
names, packet roles in explicit packet command positions, `data.*` field paths,
scoped links) from a scoped doc's text, skipping placeholders and expanding
brace-set shorthand.

**Requirements:** Advances AC1, AC2, AC3, AC4, AC5.

**Dependencies:** none (parallel to U1; consumed together in U4).

**Files:**
- `runbooks/issue-to-pr-v2/contract-drift.ts` (modify — `extractDocClaims`)
- `runbooks/issue-to-pr-v2/contract-drift.test.ts` (modify)

**Approach:** Implement narrow extractors per claim kind:
- Route-ID claims: tokens in explicit route-ID positions (``route_id: "x"``,
  backtick-quoted kebab tokens in route tables, route headings, route catalog
  bullets, and similar route contexts). Do not treat every kebab word as a
  route ID.
- Command claims: tokens following `cli.ts ` in a command position, plus
  explicit command-name bullets in the README's `cli.ts` command-list section.
- Slice claims: tokens following `cli.ts contract ` in a slice position.
- Packet-role claims: tokens following `cli.ts packet ` in a packet-role
  command position only; do not extract role claims from template filenames,
  prose role names, or workflow concepts.
- Field-path claims: `data.<dotted>` tokens; expand `{a, b, c}` into
  `data.prefix.a`, `data.prefix.b`, `data.prefix.c`, including brace sets
  split across line breaks; skip `<...>` placeholders. Do not treat arbitrary
  bare field names as claims, except explicit route-ID positions.
- Scoped-link claims: markdown links to the control-plane / recovery docs in
  scope (notably `first-run-gotchas.md`), captured with their resolved target
  path for existence checking in U3.

**Patterns to follow:** Plain string/regex extraction over file text read with
Bun's file APIs; no markdown-AST dependency (AC8 forbids new deps). Scan all
text, including fenced code blocks, because operator command examples and JSON
field recipes are high-risk drift surfaces. Trim surrounding wrappers, but keep
contract-token casing exact.

**Test scenarios:**
- Happy path: given a doc snippet containing ``route_id: "blocked-stage-3"``,
  the extractor yields a route-ID claim `blocked-stage-3`.
- Brace expansion: `data.confirmation_state.{acceptance_criteria, digests}`
  yields two field-path claims, not one literal containing braces.
- Multiline brace expansion:
  `data.drift.digest_drift.{acceptance_criteria, batch_contract, digests,
  any}` yields four field-path claims.
- Placeholder skip: `cli.ts contract <slice> --json` yields **no** slice claim
  for the literal `<slice>` token.
- Command extraction: `cli.ts diagnose <ledger> --json` yields command claim
  `diagnose` and skips `<ledger>`.
- Packet-role extraction: `cli.ts packet builder --ledger <ledger> --json`
  yields packet-role claim `builder`, while `builder-work-packet.md` and prose
  references to Builder do not.
- Scoped link: `[first-run-gotchas.md](first-run-gotchas.md)` yields a
  scoped-link claim with the resolved target path.
- Fenced code block: a stale `cli.ts` command or `data.*` path inside a fenced
  command/example block is extracted.
- Edge: a backtick word that is not in a route/command/slice position (e.g.
  prose `` `git status` ``) does not produce a contract claim (no false
  positive).
- Edge: `decompose.ts --validate-ledger-batches`, enum prose such as
  `matched | missing`, and arbitrary bare fields such as
  `installed_artifact_presence.all_present` without the `data.` prefix do not
  produce claims.

**Verification:** Extractor output for a representative slice of each scoped
doc contains the expected claim kinds and excludes placeholders and incidental
backtick prose.

---

### U3. Claim-vs-fact comparator and scoped-link existence check

**Goal:** Compare extracted claims against loaded contract facts (and scoped
link targets against the filesystem), producing structured drift findings.

**Requirements:** Advances AC1, AC2, AC3, AC4.

**Dependencies:** U1, U2.

**Files:**
- `runbooks/issue-to-pr-v2/contract-drift.ts` (modify — `compareClaimsToFacts`)
- `runbooks/issue-to-pr-v2/contract-drift.test.ts` (modify)

**Approach:** For each claim kind, membership-test the claim against the
corresponding fact set from U1; a claim absent from facts is a drift finding
`{ doc, kind, claim, reason }`. For scoped links, resolve the target relative
to the linking doc and verify it exists on disk; for the first-run gotchas
guide specifically, verify the scoped recovery-link relationship the workflow
relies on is present (AC4): the skill loop deterministically loads the guide on
`blocked-` routes, `ledger-and-helper.md` links from the route-id /
blocked-route section to the guide, and every scoped markdown link to the guide
resolves. Do not require per-route deep links, and do not require or forbid the
guide in CLI `required_reference_ids`. Findings are data, not thrown errors, so
U4 can aggregate across docs. Missing protected docs and failed CLI fact loads
are hard errors, not drift findings.

**Patterns to follow:** Set-membership comparison; structured finding records
mirror the lightweight finding shape used elsewhere in the runbook (plain
objects, no class hierarchy).

**Test scenarios:**
- Happy path: a claim set drawn entirely from the live facts produces zero
  findings.
- Route-ID drift: a claim `blocked-nonexistent-route` (not in the CLI's
  `route_ids`) produces exactly one route-ID drift finding naming that token.
- Command drift: a claim `frobnicate` produces one command drift finding.
- Slice drift: a claim `not_a_slice` produces one slice drift finding.
- Packet-role drift: a claim `buildmaster` extracted from a
  `cli.ts packet buildmaster ...` position produces one packet-role drift
  finding.
- Field-path drift: a claim `data.totally_made_up` produces one field-path
  drift finding.
- Scoped-link drift: a link to a missing recovery doc produces one link
  finding; a present link produces none.
- First-run gotchas relationship: the current `SKILL.md` deterministic
  `blocked-` load plus the `ledger-and-helper.md` route-section link produce no
  finding; removing either produces one relationship finding.
- Exact token match: a claim that differs only by surrounding wrappers or
  whitespace matches after trimming, but a case-changed token such as
  `Blocked-Stage-3` does not match.

**Verification:** Each drift category yields a precise, single finding for a
single injected bad token, and a clean claim set yields none.

---

### U4. Orchestrator, runnable entry, and the fake-stale-doc failing test

**Goal:** Tie the loader, extractor, and comparator into `checkContractDrift()`
over the four scoped docs with a thin runnable entry, and prove the check fails
on a real injected mismatch.

**Requirements:** Advances AC1, AC2, AC3, AC4, AC6, AC7.

**Dependencies:** U1, U2, U3.

**Files:**
- `runbooks/issue-to-pr-v2/contract-drift.ts` (modify — `checkContractDrift` +
  `import.meta.main` runnable entry)
- `runbooks/issue-to-pr-v2/contract-drift.test.ts` (modify — fake stale-doc
  test)

**Approach:** `checkContractDrift` owns the four scoped doc paths as explicit
structural constants (scope, not contract facts), loads facts once (U1), then
for each scoped doc reads the text, extracts claims (U2), compares (U3), and
aggregates findings into `{ ok, findings }`. The runnable entry
(`if (import.meta.main)`) prints findings in a readable form and exits non-zero
when `!ok`, zero when clean — read-only, no writes (AC6). The fake-stale-doc
test (AC7) runs the comparator (or `checkContractDrift` against a temp fixture
doc) containing a deliberately stale claim (e.g. a renamed/removed route ID)
and asserts the check reports a failure for that mismatch — proving the check
catches real drift, not just passing trivially.

**Execution note:** Write the fake-stale-doc failing test first (AC7 is the
behavioral proof the whole check exists to provide), then make the real four
scoped docs pass.

**Patterns to follow:** `import.meta.main` runnable guard as used by other bun
scripts in the repo; temp-fixture creation in tests via Bun's tmp APIs, cleaned
up after (the *test* may write a temp fixture — that is test scaffolding, not
the check writing files; the check under test remains read-only).

**Test scenarios:**
- Happy path (the real assertion this issue is about): `checkContractDrift()`
  run against the four real scoped docs returns `ok: true` with zero findings
  — the live docs are currently in sync.
- **Fake stale-doc claim (AC7):** a fixture doc containing a stale route-ID
  claim (a route ID not in the live `route_ids`) makes the check return
  `ok: false` with a finding naming that token. *This is the required proof
  the drift check fails for a real mismatch.*
- Additional injected mismatch: a fixture with a removed command name also
  fails, demonstrating the failure path is not route-ID-specific.
- Additional injected mismatches: fixtures with a removed field path, bad
  packet role, and missing scoped link fail with targeted findings.
- Missing protected doc: if one of the four scoped doc paths is absent, the
  check fails loudly as a hard error rather than returning a clean result.
- Read-only: running `checkContractDrift()` and the runnable entry produces no
  filesystem writes and no git changes (assert no side effects; e.g. the four
  scoped doc mtimes / content are unchanged).
- Aggregation: findings from multiple docs are collected into one result
  rather than short-circuiting at the first.

**Verification:** `bun test contract-drift.test.ts` passes; the fake-stale-doc
test demonstrably fails the check on an injected mismatch; running the entry
against the live repo exits zero (docs in sync) and writes nothing.

---

## System-Wide Impact

- **Operators of Issue-to-PR**: gain a guardrail that catches contract drift in
  the four docs they rely on for recovery, before they hit a stale recipe.
- **Maintainers of the v2 CLI contract**: when they rename a route ID, remove a
  command, or restructure a response field, the check surfaces which scoped doc
  still quotes the old token.
- **No runtime workflow behavior change** (AC6): the check is additive,
  read-only, and not wired into the workflow loop by this plan.

---

## Structured Implementation Units (machine-readable)

```yaml
id: contract-fact-loader
name: Contract-fact loader (read expected values from the live CLI)
goal: "The check validates mentioned cli.ts command names, contract slice names, packet roles, and finite data.* response paths against cli.ts --help --json and cli.ts contract <slice> --json, sourcing expected values from the live CLI subprocess surface at runtime."
files:
  - runbooks/issue-to-pr-v2/contract-drift.ts
  - runbooks/issue-to-pr-v2/contract-drift.test.ts
depends_on: []
execution_mode: tdd
acceptance_tests:
  - "AC 2 holds: loadContractFacts derives command names, contract slice names, and packet roles from cli.ts --help --json and cli.ts contract <slice> --json subprocess calls, asserted by comparing against live CLI calls rather than hardcoded lists."
  - "AC 3 holds: loadContractFacts derives finite nested data.* response paths from the existing state_response_shape and diagnose_response_shape help payload, stopping at the nearest known parent when a child set is not mechanically finite."
  - "AC 5 holds: the loader holds no literal route IDs, slice names, packet roles, or field paths; a grep of the check source finds no duplicate source-of-truth lists."
  - "AC 6 holds: the loader only invokes the read-only CLI and reads no mutable state; failed CLI subprocesses or error envelopes throw clear hard errors instead of returning empty facts."
ac_mapping:
  - 2
  - 3
  - 5
  - 6
rationale: null
```

```yaml
id: doc-claim-extractor
name: Doc-claim extractor (bounded contract-token patterns)
goal: "The check extracts quoted route IDs, cli.ts command/slice names, packet roles in explicit cli.ts packet <role> positions, and explicit data.* response-field paths from the scoped docs using bounded patterns over prose and fenced code blocks, skipping placeholders and expanding brace-set shorthand."
files:
  - runbooks/issue-to-pr-v2/contract-drift.ts
  - runbooks/issue-to-pr-v2/contract-drift.test.ts
depends_on: []
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds: route-ID claims are extracted from explicit route-ID positions in the scoped docs for comparison against cli.ts contract route_ids --json."
  - "AC 2 holds: command and slice claims are extracted only from cli.ts command positions, and packet-role claims only from explicit cli.ts packet <role> command positions."
  - "AC 3 holds: data.* field-path claims are extracted from prose and fenced code blocks, with {a, b, c} brace-sets, including multiline brace sets, expanded into individual paths and <placeholder> tokens skipped."
  - "AC 5 holds: the extractor reads docs and emits claims only; it holds no expected contract values of its own."
ac_mapping:
  - 1
  - 2
  - 3
  - 5
rationale: "Split from comparison (U3) because extraction patterns and fact-comparison are separable concerns tested independently; the extractor is the surface most prone to false positives and warrants its own unit."
```

```yaml
id: claim-fact-comparator
name: Claim-vs-fact comparator and scoped-link existence check
goal: "The check validates extracted claims against loaded contract facts and validates only the recovery/control-plane links needed for this scope, especially links involving the first-run gotchas guide, producing structured drift findings."
files:
  - runbooks/issue-to-pr-v2/contract-drift.ts
  - runbooks/issue-to-pr-v2/contract-drift.test.ts
depends_on:
  - contract-fact-loader
  - doc-claim-extractor
execution_mode: tdd
acceptance_tests:
  - "AC 1 holds: a route-ID claim absent from cli.ts contract route_ids --json produces exactly one route-ID drift finding."
  - "AC 2 holds: a command-name, slice-name, or explicit packet-role claim absent from the live CLI facts produces a drift finding."
  - "AC 3 holds: a data.* field-path claim absent from the documented response shapes produces a drift finding."
  - "AC 4 holds: scoped recovery/control-plane links (especially first-run-gotchas.md) are checked for target existence and the deterministic gotchas-guide relationship; a missing target or broken relationship produces one finding and a present one produces none."
ac_mapping:
  - 1
  - 2
  - 3
  - 4
rationale: null
```

```yaml
id: orchestrator-and-stale-doc-test
name: Orchestrator, runnable entry, and the fake-stale-doc failing test
goal: "The check runs read-only over the four scoped docs and ships a test with at least one fake stale-doc claim proving the drift check fails for a real mismatch."
files:
  - runbooks/issue-to-pr-v2/contract-drift.ts
  - runbooks/issue-to-pr-v2/contract-drift.test.ts
depends_on:
  - contract-fact-loader
  - doc-claim-extractor
  - claim-fact-comparator
execution_mode: tdd
acceptance_tests:
  - "AC 7 holds: a fixture doc with a deliberately stale contract claim (e.g. a route ID not in the live route_ids) makes the check return ok:false with a finding naming that token, proving the check fails for a real mismatch."
  - "AC 6 holds: checkContractDrift and the runnable entry perform no filesystem writes and no git mutations; the four scoped docs are unchanged after a run."
  - "AC 1 holds: run against the four explicit scoped doc paths, the check returns ok:true (docs currently in sync) by validating their quoted route IDs against cli.ts contract route_ids --json; a missing scoped doc is a hard error, not a clean result."
ac_mapping:
  - 1
  - 6
  - 7
rationale: "Merges orchestration and the AC7 proof test into one unit because the fake-stale-doc test exercises the full checkContractDrift path; they live in the same file and share inseparable test scaffolding."
```

```yaml
id: out-of-scope-guard
name: Out-of-scope boundary (no broad audit, no new deps, no generated docs)
goal: "AC 8: Broad docs consistency, all Issue-to-PR references, prose truth judgments, new CLI observability, generated docs, and new dependencies are out of scope."
files:
  - runbooks/issue-to-pr-v2/contract-drift.ts
depends_on:
  - orchestrator-and-stale-doc-test
execution_mode: change_first
acceptance_tests:
  - "AC 8 holds: the delivered check covers only the four scoped docs and the contract-token kinds named in AC1-AC4, adds no dependency to package.json, adds no new CLI command or emitted fact, generates no docs, and does not validate decompose.ts flags, route precedence, enum prose, template filenames, or role-ish workflow words outside explicit cli.ts packet <role> command positions."
ac_mapping:
  - 8
rationale: "out-of-scope: investigation-required"
```
