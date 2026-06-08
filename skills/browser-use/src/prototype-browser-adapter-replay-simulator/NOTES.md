# Browser Adapter Replay Simulator Notes

Source: prototype request on 2026-06-03.

## Question

- Simulate Browser Adapter Proof failure.
- Read Browser Adapter Map guidance.
- Apply the mapped recovery.
- Rerun proof.
- See whether the loop converges, warns, or stops.

## Early Answer

- Convergent cases need proof to clear stale evidence after every repair.
- `use_verified_browser_adapter` is the only Router-proof handoff.
- `adapter_signal_weak` can continue without repair when proof status is `ok`.
- Risk states need a clean stop or human handoff, not automatic adapter fallback.
- Repeated repair with no state change should become a bounded stop.

## Shared Machinery Candidate

- Loop state: `prove -> read_map -> recover -> prove -> reroute`.
- Recovery application result: `changed`, `unchanged`, or `human_handoff`.
- Retry budget per diagnostic.
- Proof evidence freshness marker.
- Router handoff readiness flag.

## Adapter-Specific Inputs

- `chrome-devtools` stale config can converge after `update_adapter_config`.
- `agent-browser` missing dependency can converge after `configure_adapter_dependency`.
- `agent-browser` auto-launch risk should stop for inspection or human repair.
- Empty tabs/page list should continue as warning-only success.

## Prototype Learning

- Map coverage alone is insufficient; the loop needs outcome semantics.
- Recovery actions should say whether a state change is expected.
- Proof should be rerun after every repair before Router sees evidence.
- Human handoff should be explicit when recovery is inspection-only.
- Retry budget prevents endless “inspect then retry” loops.

## Production Shape Candidate

- Keep Browser Adapter Proof as the source of truth for current status.
- Let Browser Adapter Map name recovery action and local commands.
- Add recovery outcome expectations to runtime guidance or map metadata.
- Keep Router blocked until fresh proof evidence is attached.
- Add smoke cases for convergent repair, warning-only success, and clean stop.

## Open Questions

- Should recovery outcome metadata live in maps or command contract data?
- Should `inspect_adapter_config` ever auto-clear a risk state?
- How many retries should proof allow before a human handoff?
- Should Router receive warning-only proof evidence with a warning summary?
