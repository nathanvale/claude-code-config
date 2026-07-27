---
title: Browser Use Front Door Decision Log
slug: browser-use-front-door
type: decision-log
status: accepted
date: "2026-07-27"
timezone: Australia/Melbourne
owner: browser-use-front-door
source:
  - /tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md
decision_metadata_format: fenced-yaml-per-decision
---

# Browser Use Front Door Decision Log

## Frame

- Record accepted product decisions for the public `browser-use` command surface.

## Notes

- Lifecycle scope resolved: no public stop, profile selector, or remote-debugging-off control in v1.

## Decision 1: Auto-mint and consume a fresh Verified Handoff Envelope inside handoff-bound...

```yaml
id: browser-use-front-door-001
status: accepted
decided_at: "2026-07-27"
decision: "Auto-mint and consume a fresh Verified Handoff Envelope inside handoff-bound targets list when --handoff is absent"
owner: "browser-use-front-door"
source:
  - "/tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md"
  - "2026-07-27 Codex session: targets-list mint-path grill"
```

Decision:

- Let `browser-use targets list --mode handoff-bound --adapter <id>` mint and consume a fresh Verified Handoff Envelope when `--handoff` is absent.
- Keep caller-supplied `--handoff` as the advanced override.

Rationale:

Fresh minting extends the accepted D4 everyday-path behavior. It preserves Browser Connect ownership, keeps Browser Use as the only public front door, and avoids persisted live connection evidence with stale reuse semantics.

Consequences:

Public target discovery no longer requires callers to invoke `browser-connect`. `--adapter` selects the adapter only when Browser Use must mint. A supplied handoff remains authoritative and is still cross-checked against any supplied adapter.

Next:

Add one failing public-surface test, implement the smallest shared mint path, then prove discovery metadata, rendered help, parser acceptance, and runtime semantics stay aligned.

V2 Ideas:

- Persist a reusable handoff only if a concrete multi-command workflow proves fresh per-command minting insufficient.

## Decision 2: Extend routine-automation with one semantic click action resolved from the cu...

```yaml
id: browser-use-front-door-002
status: accepted
decided_at: "2026-07-27"
decision: "Extend routine-automation with one semantic click action resolved from the current snapshot and one named visible-element postcondition"
owner: "browser-use-front-door"
source:
  - "/tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md"
  - "2026-07-27 Codex session: mutating Task Intent grill"
```

Decision:

- Extend `routine-automation` with one typed semantic click action.
- Accept an exact accessible role and name, a postcondition id, and one visible-element selector.
- Resolve exactly one ref from the current task-local snapshot before clicking.
- Keep raw refs and the adapter task-step schema private.

Rationale:

Agent Browser v0.31.2 exposes structured role/name metadata for each fresh snapshot ref. Resolving against that metadata prevents a stale raw ref from silently targeting a different element. A single semantic click plus named structural postcondition is the smallest shape that proves observe, mutate, and fresh verify without exposing general step JSON.

Consequences:

Zero or multiple role/name matches refuse before mutation. Successful resolution clicks only the current snapshot ref, discards refs after mutation, and verifies the declared postcondition. Verification unavailability becomes `unknown`; an unmet postcondition becomes `not-achieved`. Other action and postcondition kinds stay out of v1.

Next:

Add a failing public `task run` test, then implement semantic resolution, task compilation, run postcondition persistence, help, parser, and outcome evidence one vertical slice at a time.

V2 Ideas:

- Add fill and navigation actions only after the click slice proves the contract.
- Add value and URL postconditions when a concrete workflow needs them.

## Decision 3: Keep Agent Chrome stop outside the public Browser Use lifecycle surface

```yaml
id: browser-use-front-door-003
status: accepted
decided_at: "2026-07-27"
decision: "Keep Agent Chrome stop outside the public Browser Use lifecycle surface"
owner: "browser-use-front-door"
source:
  - "/tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md"
  - "2026-07-27 Codex session: lifecycle stop-surface grill"
```

Decision:

- Keep Agent Chrome stop outside the public `browser-use` lifecycle surface.
- Treat fixture teardown and operator-owned stop as not applicable to C01 product acceptance.

Rationale:

Warm Chrome is a reusable browser service. Proving that a listener belongs to Agent Chrome does not grant the public front door safe authority to terminate an existing process. A stop control would widen the destruction boundary without improving the everyday launch and attach path.

Consequences:

Browser Use may prove, attach to, launch, or repair Agent Chrome through Browser Connect. It does not stop an existing listener. Lifecycle tests that require an absent browser arrange that precondition outside the product surface and record the setup separately from product acceptance.

Next:

Document the deliberate lifecycle boundary, then keep C01 focused on the public cold-launch journey.

V2 Ideas:

- Add a stop owner only if a concrete operator workflow supplies process provenance, lease semantics, and a no-human-browser termination proof.

## Decision 4: Keep physical and logical profile selection outside the Browser Use v1 public...

```yaml
id: browser-use-front-door-004
status: accepted
decided_at: "2026-07-27"
decision: "Keep physical and logical profile selection outside the Browser Use v1 public surface"
owner: "browser-use-front-door"
source:
  - "/tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md"
  - "2026-07-27 Codex session: lifecycle profile-selector grill"
```

Decision:

- Keep `browser-use` v1 fixed to the Browser Connect identity `agent-chrome/default`.
- Do not expose a public physical or logical profile selector.
- Treat C04's wrong-profile request as not applicable to the v1 product model.

Rationale:

Browser Connect v1 owns one logical identity. Warm Chrome owns its physical profile directory. Exposing a Browser Use profile flag would either leak an owner-private path or advertise identities the connection model cannot represent.

Consequences:

The public front door continues to reject foreign listeners before adapter dispatch. That live safety proof remains required. Multiple Agent Chrome identities require an end-to-end logical identity catalog owned by Browser Connect before Browser Use can expose selection.

Safety cross-reference:

`DDA-F26` remains the governing default-profile invariant. Fixing v1 to `agent-chrome/default` never authorizes attachment to, repair of, launch into, or remote-debugging enablement on the user's real default Chrome profile.

Next:

Document the single-profile boundary and preserve the C04 foreign-listener refusal receipt.

V2 Ideas:

- Add a code-owned logical profile catalog when a concrete multi-identity workflow exists.

## Decision 5: Keep remote-debugging enablement outside the Browser Use public lifecycle sur...

```yaml
id: browser-use-front-door-005
status: accepted
decided_at: "2026-07-27"
decision: "Keep remote-debugging enablement outside the Browser Use public lifecycle surface"
owner: "browser-use-front-door"
source:
  - "/tmp/browser-use-front-door-product-gaps-handoff-2026-07-27.md"
  - "2026-07-27 Codex session: remote-debugging lifecycle grill"
```

Decision:

- Do not expose a Browser Use control that launches Agent Chrome with remote debugging disabled.
- Treat C06's public-knob requirement as not applicable to the Agent Chrome product model.
- Retain typed failure coverage for an unavailable or unusable Agent Chrome endpoint.

Rationale:

Agent Chrome is defined by a verified CDP endpoint. Disabling remote debugging removes the connection capability rather than selecting a supported lifecycle mode. A public knob would create an intentionally unusable browser configuration.

Consequences:

Remote-debugging-off remains an external fault fixture or lower-layer test concern. Browser Use must still return typed launch or connection failure evidence without dispatching an adapter when no usable endpoint becomes available.

Safety cross-reference:

`DDA-F26` governs every lower-layer enable path. Keeping enablement outside the public Browser Use lifecycle does not authorize a persistent remote-debugging toggle against the user's real default Chrome profile.

Next:

Document the C06 classification and retain the existing typed `launch_failed` proof.

V2 Ideas:

- Add richer endpoint-unavailable diagnostics if live failure evidence cannot distinguish launch, readiness, and listener faults.
