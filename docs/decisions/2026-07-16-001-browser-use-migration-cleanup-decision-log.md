---
title: Browser-Use Migration Cleanup
slug: browser-use-migration-cleanup
type: decision-log
status: in-progress
date: "2026-07-16"
timezone: Australia/Melbourne
owner: browser-use
source:
  - docs/plans/2026-07-16-001-refactor-browser-use-migration-cleanup-plan.md
  - "PR #237 (U1-U3), PR #238 (U4), PR #239 (U5)"
decision_metadata_format: fenced-yaml-per-decision
---

# Browser-Use Migration Cleanup

## Frame

`browser-connect` (2026-07-14 decision log) became the browser entry product;
this migration made `skills/browser-use` its consumer and deleted the Router
chain it replaced. The cleanup ran as units U1-U7: U1 envelope seam, U2
SKILL.md rewrite, U3 chain deletion (PR #237), U4 shared mcporter-transport
package (PR #238), U5 rule retirement + delegator deletion (PR #239), U6
issue-closure execution, U7 this log. Each decision below is one durable
outcome of that migration; the issue-triage ledger is embedded as Decision 8.

## Notes

- Roadmap pitches live in `runtime/browser-connect/TASKS.md` `## Roadmap`
  (KTD7); this log records decisions, not the work queue.
- Review-surfaced roadmap footnotes (not decisions): operate-time endpoint
  re-verification (refuted as a regression fix, valid as a hardening pitch);
  a `playwright-cdp` recovery dead-end enum entry;
  `target_selection_input_invalid` diagnostic code split.

## Decision 1: browser-use consumes browser-connect through one --handoff Verified Handoff E...

```yaml
id: browser-use-migration-cleanup-001
status: accepted
decided_at: "2026-07-16"
decision: "browser-use consumes browser-connect through one --handoff Verified Handoff Envelope"
owner: "browser-use"
source:
  - "docs/plans/2026-07-16-001-refactor-browser-use-migration-cleanup-plan.md"
  - "PR #237"
```

Decision:

- `skills/browser-use` enters a browser session only through the Verified
  Handoff Envelope emitted by `browser-connect connect --json`, passed as one
  `--handoff` input; the session model moved route-bound -> handoff-bound (KTD2).
- Consumer-side contract pins (KTD1): browser-use validates
  `BROWSER_CONNECT_HANDOFF_CONTRACT_ID` / `BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION`
  in `skills/browser-use/src/command-contract.ts`; a v2 envelope fails closed on
  a v1 consumer instead of degrading silently.

Rationale:

One envelope seam replaces the Router chain's multi-proof choreography; the
consumer never sees a raw endpoint, so endpoint authority stays with
browser-connect (R8 lineage).

Consequences:

Future agents integrate with browser-use by producing a valid handoff envelope,
not by re-proving Chrome; schema evolution is a browser-connect decision with a
fail-closed consumer.

Next:

None — landed in PR #237.

V2 Ideas:

- None.

## Decision 2: ADR 0012 Router governance ends; R9 engine cluster survives as the adapter-fa...

```yaml
id: browser-use-migration-cleanup-002
status: accepted
decided_at: "2026-07-16"
decision: "ADR 0012 Router governance ends; R9 engine cluster survives as the adapter-fallback candidate"
owner: "browser-use"
source:
  - "PR #237"
  - "docs/adr/0012 (disposition)"
```

Decision:

- browser-use governance of the Browser Adapter Router (ADR 0012) ends at this
  migration; ADR 0009 stays intact.
- The R9 engine cluster (engine/model/recovery/validation + constants) survives
  as the adapter-fallback candidate. Its dead exports and Router-era internal
  vocabulary await a named R9 retirement-or-revival unit.

Rationale:

Deleting the cluster now would forfeit the only modeled adapter-fallback
implementation while its revival trigger is plausible; keeping it dormant is
cheaper than rebuilding it.

Consequences:

The no-dangle sweep deliberately excludes the R9 internal vocabulary; agents
must not "clean up" those files outside the named unit.

Next:

Revival trigger: adapter registry reaches 3+ adapters, or the first
wrong-adapter incident.

V2 Ideas:

- None.

## Decision 3: Route expiry is retired by design; the handoff envelope carries no freshness...

```yaml
id: browser-use-migration-cleanup-003
status: accepted
decided_at: "2026-07-16"
decision: "Route expiry is retired by design; the handoff envelope carries no freshness gate"
owner: "browser-use"
source:
  - "PR #237 adversarial review"
```

Decision:

- The Verified Handoff Envelope carries no timestamps, so `operate` has no
  freshness gate on connection evidence. The selected-state 15-minute TTL
  remains the only time gate.

Rationale:

Adding `emitted_at_ms` would be a browser-connect schema change — out of scope
for this migration and a named stop condition. Adversarial review flagged the
gap; recording it as deliberate prevents it resurfacing as a "bug".

Consequences:

A stale envelope is caught by the attachment failing at operate time
(fail-closed), not by a freshness check.

Next:

None — revisit only via a browser-connect schema decision.

V2 Ideas:

- Operate-time endpoint re-verification as a hardening pitch (roadmap
  footnote), not a regression fix.

## Decision 4: v2 self-describing discovery envelopes fix the latent targets list-to-select...

```yaml
id: browser-use-migration-cleanup-004
status: accepted
decided_at: "2026-07-16"
decision: "v2 self-describing discovery envelopes fix the latent targets list-to-select pipe bug"
owner: "browser-use"
source:
  - "PR #237"
```

Decision:

- Discovery envelopes self-describe `contract` + `schema_version` (v2), making
  the real pipeline `targets list --json | targets select` work.

Rationale:

The real pipe NEVER worked pre-migration: `list` output carried no
`data.contract`, so only the tests' hand-built envelopes passed `select`. This
is the fakes-vs-real-shape defect class — the fake matched the intended shape,
not the emitted one.

Consequences:

Envelope-shape proofs must exercise the real emitting command at a process
boundary, not hand-built fixtures alone (see
`browser-connect-process-boundary.test.ts` for the pattern).

Next:

None — landed in PR #237.

V2 Ideas:

- None.

## Decision 5: Documented front-door flows must name the state source and be runnable as wri...

```yaml
id: browser-use-migration-cleanup-005
status: accepted
decided_at: "2026-07-16"
decision: "Documented front-door flows must name the state source and be runnable as written"
owner: "browser-use"
source:
  - "PR #237 review; fix 33c88d8b"
```

Decision:

- Every documented front-door flow in `skills/browser-use/SKILL.md` must name
  where its state comes from and must run as written.

Rationale:

Review found the SKILL.md "pass run id once" flow failed closed at `select`
(`target_selection_state_path_missing`); the prose omitted the state source.
Fixed in 33c88d8b. Lesson: skill-author verification gates check document
structure, not runnable-workflow truth.

Consequences:

Skill reviews of command workflows need at least one as-written execution of
the documented flow, not structural checks alone.

Next:

None — fixed on the branch that merged as PR #237.

V2 Ideas:

- A mechanical "runnable prose" gate for skill workflow blocks.

## Decision 6: The preflight-warm-chrome delegator and its BROWSERUSE env bridge retire deli...

```yaml
id: browser-use-migration-cleanup-006
status: accepted
decided_at: "2026-07-16"
decision: "The preflight-warm-chrome delegator and its BROWSER_USE_* env bridge retire deliberately"
owner: "browser-use"
source:
  - "PR #239 (U5/KTD6)"
```

Decision:

- `skills/browser-use/src/preflight-warm-chrome.ts` (+ test + bin) is deleted
  with `rules/browser-access.md` (KTD6, U5). Its `BROWSER_USE_*` ->
  `WARM_CHROME_*` env bridge and its unhandled-failure net retire with it —
  deliberately, not as an oversight.

Rationale:

The delegator existed to bridge the switchover window; browser-connect
consuming warm-chrome in-process closed that window. The rule's four
invariants are mechanically enforced or re-homed (see PR #239 disposition
table).

Consequences:

No env-var channel into warm-chrome survives from browser-use; consumers reach
proof behavior only through browser-connect. The no-dangle deny list guards the
deleted command names.

Next:

None — landed in PR #239.

V2 Ideas:

- None.

## Decision 7: Shared runtime/mcporter-transport package closes KTD8

```yaml
id: browser-use-migration-cleanup-007
status: accepted
decided_at: "2026-07-16"
decision: "Shared runtime/mcporter-transport package closes KTD8"
owner: "browser-use"
source:
  - "PR #238 (U4)"
```

Decision:

- The shared workspace package `runtime/mcporter-transport`
  (`@side-quest/mcporter-transport`) owns command-vector types, no-shell
  spawn, and the parity checklist (KTD8, from the browser-connect plan).
- browser-use binds its `BROWSER_USE_MCPORTER_COMMAND_JSON` channel to it;
  the browser-connect adapter registry adopts the same seam.

Rationale:

Two hand-rolled mcporter spawn paths were drifting; one contract-owned package
makes transport behavior a single decision surface.

Consequences:

Transport changes happen in `runtime/mcporter-transport`, never inline in a
consumer; both consumers prove parity against its checklist.

Next:

None — landed in PR #238.

V2 Ideas:

- None.

## Decision 8: U6 issue triage: close 147 and 170; re-scope 136-146 onto roadmap pitches

```yaml
id: browser-use-migration-cleanup-008
status: accepted
decided_at: "2026-07-16"
decision: "U6 issue triage: close #147 and #170; re-scope #136-#146 onto roadmap pitches"
owner: "browser-use"
source:
  - "U6 triage ledger, operator-approved 2026-07-16"
```

Decision:

- Executed 2026-07-16 (operator-approved): closed #147 and #170; posted
  re-scope comments on #136-#146, which stay open as roadmap work re-anchored
  to the Verified Handoff Envelope as session entry.
- Embedded ledger:

| # | Disposition | Evidence / re-anchor | Pitch |
|---|---|---|---|
| 136 | re-scope | Revive browser-domain-memory from `skills/archive/` as consumer of browser-use/browser-connect | operation floor |
| 137 | re-scope | Router removed from criteria; envelope is the session entry point | operation floor + deterministic mode |
| 138 | re-scope | Implement as browser-domain-memory internals; entry via envelope | operation floor |
| 139 | re-scope | Re-block on re-scoped #137/#138 with the handoff entry contract | operation floor |
| 140 | re-scope | Capture/redact/atomic-commit in revived package; session from envelope | operation floor |
| 141 | re-scope | Facade calls `browser-connect connect/run`; lock discipline unchanged | operation floor |
| 142 | re-scope | "Verified loopback endpoint" = connect envelope endpoint field | deterministic mode |
| 143 | re-scope | puppeteer session initialises from envelope endpoint | deterministic mode |
| 144 | re-scope | Warm-session preflight = `browser-connect connect <agent-browser>` success | per-agent target allocation + operation floor |
| 145 | re-scope | Keep 1Password integration + leak checks; drop router-era rewrite | 1Password-backed login |
| 146 | re-scope | Prose consistency met by U2; keep consult-gate code handshake | UI-consent door (slice two) |
| 147 | CLOSED | Glossary + Retired terms in CONTEXT.md; criteria met by PR #237 | — |
| 170 | CLOSED | `prepare` deleted; run-id threading documented in SKILL.md; gap moot | — |

Rationale:

All 11 re-scoped issues predate browser-connect and remain valid product work;
closing them would lose the pitches, rewriting them now would front-run the
roadmap triggers.

Consequences:

Issue criteria referencing the Router are historical; the re-scope comments on
each issue are the live acceptance framing.

Next:

Pick up any pitch when its roadmap trigger fires
(`runtime/browser-connect/TASKS.md` `## Roadmap`).

V2 Ideas:

- None.

## Decision 9: Live smoke AE1/AE4 stays pending-operator behind the foreign CDP listener

```yaml
id: browser-use-migration-cleanup-009
status: accepted
decided_at: "2026-07-16"
decision: "Live smoke AE1/AE4 stays pending-operator behind the foreign CDP listener"
owner: "browser-use"
source:
  - "skills/browser-use/TEST_MATRIX.md"
  - "runtime/browser-connect/REPAIR.md"
```

Decision:

- AE1 (run-id chain) and AE4 (fail-closed) live smoke on a real Agent Chrome
  remain pending-operator: a foreign listener holds the default CDP port, so
  `browser-connect check` exits `20` (`foreign-listener`) — the fail-closed
  behavior working as designed.

Rationale:

Never kill an unverified listener (R13); remediation is operator-owned via
`runtime/browser-connect/REPAIR.md#v1-inspect_listener`.

Consequences:

TEST_MATRIX.md rows AE1/AE4 stay marked pending-operator; unit and
process-boundary coverage stands in until the operator clears the port.

Next:

Operator: follow `REPAIR.md#v1-inspect_listener`, then run AE1/AE4 and update
TEST_MATRIX.md.

V2 Ideas:

- None.
