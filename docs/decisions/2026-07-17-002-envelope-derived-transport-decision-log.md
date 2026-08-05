---
title: Envelope-Derived Browser Transport
slug: envelope-derived-transport
type: decision-log
status: complete
date: "2026-07-17"
timezone: Australia/Melbourne
owner: browser-use-transport
source:
  - docs/plans/2026-07-17-001-refactor-envelope-derived-transport-plan.md
  - "PRs #243-#247 (U1-U5, merged 2026-07-17)"
  - skills/browser-use/src/mcporter-adapter-process-boundary.test.ts
decision_metadata_format: fenced-yaml-per-decision
---

# Envelope-Derived Browser Transport — Decision Log

## Frame

Decisions 1 through 3 are superseded by ADR 0031. They remain below as
historical evidence for the executor architecture being retired.

The 2026-07-17 refactor plan re-anchored browser-use's live transport on the
Verified Handoff Envelope. Execution (U1–U6) surfaced empirical seam behavior
that amended the plan's KTD1 and forced two deviations. This log records the
shipped decisions so future agents do not re-derive them from the diffs.
Authority: this log sits under the plan and the 2026-07-16/2026-07-14 decision
logs it defers to.

## Decision 1: Envelope-derived mcporter invocation is the shipped live transport

```yaml
id: envelope-derived-transport-001
status: superseded
superseded_by: docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md
decided_at: "2026-07-17"
decision: browser-use keeps mcporter as the MCP protocol client and derives every live adapter invocation ad-hoc from the Verified Handoff Envelope
owner: browser-use-transport
source:
  - docs/plans/2026-07-17-001-refactor-envelope-derived-transport-plan.md
  - "PRs #244, #245"
```

Decision:

- Every live adapter call spawns the envelope's pinned binary (`--stdio
  <attachment.probe_executable>`) with the verified endpoint injected verbatim
  (`--stdio-arg --browser-url --stdio-arg <endpoint.http>`). The
  configured-server call form (`<server>.<tool>`) is deleted.
- The argv is pinned as data (`ENVELOPE_ADAPTER_ARGV_CONTRACT` in
  `skills/browser-use/src/mcporter-adapter-process-boundary.test.ts`), proven
  against real mcporter 0.12.2 before the transport change landed.
- The deferred native-transport V2 question is resolved as "not needed":
  mcporter stays the protocol client.

Rationale:

- Endpoint authority was honored up to the envelope and then abandoned to
  user-level static config — the source of the live-smoke friction (hand-wired
  config entry, silently stale `--browser-url`) recorded in the plan.

Consequences:

- KTD1 runtime pin unchanged: browser-use still duplicates the contract id and
  schema version; a browser-connect schema rev fails closed.
- `readHandoffFacts` rejects a missing or non-absolute `probe_executable` as
  handoff-invalid (KTD3): no PATH guessing, no fallback.
- Parity-checklist item 3 in `runtime/mcporter-transport/src/index.ts` is
  resolved on the mcporter path; the checklist still governs any future native
  transport.

Next:

- Live evidence: `skills/browser-use/TEST_MATRIX.md` rows U6-ET3/U6-ET4
  (run id `u6-live-chain`).

V2 Ideas:

- Native MCP stdio transport stays available behind the seven-item parity
  checklist if mcporter becomes a liability.

## Decision 2: MCPORTER_NO_KEEPALIVE guard and named ad-hoc server are mandatory

```yaml
id: envelope-derived-transport-002
status: superseded
superseded_by: docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md
decided_at: "2026-07-17"
decision: every envelope-derived spawn sets MCPORTER_NO_KEEPALIVE=* and names the ad-hoc server; without the guard mcporter daemon-routes the call to the configured server
owner: browser-use-transport
source:
  - skills/browser-use/src/mcporter-adapter-process-boundary.test.ts
  - "PR #245"
```

Decision:

- `ENVELOPE_ADAPTER_CALL_ENV` (`MCPORTER_NO_KEEPALIVE: "*"`) rides every
  envelope-derived call, and the ad-hoc server carries
  `--name browser-use-envelope-adapter`.

Rationale:

- Observed live (U1): mcporter 0.12.2 classifies any stdio command containing
  the fragment `chrome-devtools-mcp` as keep-alive and routes it through its
  daemon. With the daemon running, the bare ad-hoc call was silently answered
  by the daemon-managed configured `chrome-devtools` server — wrong binary,
  wrong endpoint, exit 0 — exactly the config-seam defect this refactor
  deletes. A named ad-hoc server without the guard fails
  "not managed by the daemon". The env var takes a name list or `*`; `=1`
  matches nothing.

Consequences:

- The U1 proof test asserts the daemon-shadow tripwire (`no page listing on an
  unreachable endpoint`) on every suite run.
- `runTransportCommand` gained optional env threading (merge-over-inherited,
  never exactEnv) to carry the guard.

Next:

- None; guard is code-owned and test-pinned.

V2 Ideas:

- Upstream a `--no-daemon` call flag to mcporter so the guard can retire.

## Decision 3: Page targeting via experimentalPageIdRouting; select_page only on explicit focus

```yaml
id: envelope-derived-transport-003
status: superseded
superseded_by: docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md
decided_at: "2026-07-17"
decision: operations carry pageId directly via the adapter's --experimentalPageIdRouting flag; the default select_page transport step is deleted; --bring-to-front still issues select_page with bringToFront true
owner: browser-use-transport
source:
  - skills/browser-use/src/mcporter-adapter-process-boundary.test.ts
  - "PR #245"
```

Decision:

- The spawn args include `--experimentalPageIdRouting`; `take_snapshot`,
  `take_screenshot`, and `emulate` args carry the resolved `pageId`.
- `select_page` is issued only when the operator explicitly passes
  `--bring-to-front` (recorded focus side effect).

Rationale:

- Observed live (U1): adapter selection state is process-local. The old
  select_page→operate two-call sequence only ever worked because the mcporter
  daemon held one adapter process across calls; under ephemeral ad-hoc spawns a
  fresh process re-derives selection from CDP target order (not the focused
  tab — verified even after bringToFront). Without pageId routing, the
  envelope-derived model could not express targeted operations at all.

Consequences:

- Operation results now bind to the run-scoped selected target by pageId, not
  to daemon session state; the implicit focus side effect is gone.
- Version-drift risk of the experimental flag is bounded by the
  browser-connect 1.5.0 adapter pin; the flag's presence in the argv contract
  means an adapter rev that drops it fails visibly in the U1 proof.

Next:

- Re-pin the flag's behavior when the adapter pin advances past 1.5.0.

V2 Ideas:

- None.

## Decision 4: Selected-state schema unchanged; operate derives facts from the re-read envelope

```yaml
id: envelope-derived-transport-004
status: accepted
decided_at: "2026-07-17"
decision: the run-scoped selected-target state file does not carry probeExecutable or endpointHttp; operate re-reads the envelope it already requires and derives transport facts from it
owner: browser-use-transport
source:
  - "PR #245"
  - docs/plans/2026-07-17-001-refactor-envelope-derived-transport-plan.md
```

Decision:

- Plan deviation, accepted: U3's text assumed state carries the two new
  transport fields. It does not need to — `operate` requires `--handoff` and
  re-parses the envelope every run, and the existing four-way binding
  cross-check (adapter, evidence hash, endpoint identity, envelope id) already
  pins select and operate to the same envelope.

Rationale:

- Smaller diff, stronger authority chain: the endpoint flows from the envelope
  to every spawn with no intermediate copy that could go stale.

Consequences:

- No state schema bump; existing state files stay valid within their TTL.

Next:

- None.

V2 Ideas:

- None.

## Decision 5: Recovery-mode live discovery requires a verified envelope

```yaml
id: envelope-derived-transport-005
status: accepted
decided_at: "2026-07-17"
decision: recovery-mode targets list without verified-envelope evidence fails closed (target_discovery_transport_failed, supply_verified_handoff) instead of listing pages through configured transport
owner: browser-use-transport
source:
  - "PR #245"
```

Decision:

- Behavior change, accepted: failure-envelope and no-evidence recovery entries
  can no longer perform live page listing.

Rationale:

- R1/R3 leave no invocation source: once the configured-server form is deleted,
  only a verified envelope names a binary and endpoint. Silent fallback would
  reintroduce the config seam.

Consequences:

- The AE2-era "recovery from envelope only" flow still works (a verified
  envelope was always its evidence); pure no-evidence recovery now routes to
  `supply_verified_handoff`.

Next:

- None; SKILL.md Next Safe Action wording updated to match.

V2 Ideas:

- None.

## Decision 6: The user-level mcporter chrome-devtools entry is inert

```yaml
id: envelope-derived-transport-006
status: accepted
decided_at: "2026-07-17"
decision: nothing in the browser stack reads the chrome-devtools server entry in ~/.config/mcporter/mcporter.json; the operator may delete it
owner: browser-use-transport
source:
  - "PR #245"
  - skills/browser-use/TEST_MATRIX.md
```

Decision:

- The hand-wired `chrome-devtools` entry (and the daemon keep-alive session it
  spawns) is no longer consumed by any browser-use or browser-connect path.

Rationale:

- Every live call is envelope-derived (Decision 1) and daemon-shielded
  (Decision 2); the config entry's only remaining effect is a stray daemon
  process holding an adapter session.

Consequences:

- Operator may remove the entry and stop the daemon
  (`mcporter daemon stop`) at leisure; nothing in the stack changes behavior.
- Other mcporter consumers (e.g. `playwright-cdp` entries, unrelated servers)
  are untouched by this decision.

Next:

- Optional operator cleanup; no code action.

V2 Ideas:

- None.

## Notes

- mcporter keep-alive routing internals (fragment matching in its
  `lifecycle.js`) were read from the installed 0.12.2 dist during U1; if a
  future mcporter version changes daemon routing, the U1 proof test is the
  tripwire.
- The handoff fixture (`REAL_VERIFIED_HANDOFF_ENVELOPE`) is now a 2026-07-17
  live capture with the production absolute pinned path; the old emission-path
  capture carried a test-resolver relative path that the KTD3 guard would
  reject.
