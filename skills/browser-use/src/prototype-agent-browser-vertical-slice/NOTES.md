# Agent Browser Vertical Slice Notes

Source: prototype request on 2026-06-13.

## Question

- Prove the minimum `agent-browser` vertical slice before promoting Adapter, Template Method, or Abstract Factory names.
- Keep the prototype throwaway.
- Keep production code untouched until the proof shape feels right.

## Early Answer

- `agent-browser` needs four proof facts before it should become provable:
  dependency availability, verified Warm Chrome binding, one harmless action probe, and risk scan.
- A passing vertical slice earns pressure for an `AdapterProofSpec`-shaped production module.
- It does not by itself promote Factory or Template Method names.
- Browser Adapter Map and selectable Router routing stay deferred until a real map and production proof handler exist.

## Slice Shape

- `known`: adapter id exists.
- `reportable`: capability report can exist.
- `dependency_checked`: adapter command is available.
- `binding_checked`: adapter session binds to the verified Warm Chrome endpoint.
- `action_probe_checked`: one harmless action proves the adapter acts against that session.
- `risk_scanned`: auto-launch and Chrome-for-Testing risks are absent.
- `provable`: all prior blocking gates pass.
- `mapped`: map exists and validates recovery guidance.
- `selectable`: Router may route to the adapter.

## Prototype Learning

- Missing dependency, stale binding, and action failure block provability with distinct diagnostics.
- Zero tabs is a warning, not a blocker.
- Auto-launch and Chrome-for-Testing risks block provability.
- The production seam should keep adapter-local commands local.
- Shared vocabulary should stay code-owned in `command-contract.ts`.

## Production Verdict

- Next production slice: add an `agent-browser` proof handler that emits the same proof envelope shape as `chrome-devtools`.
- Required proof: dependency check, CDP/session binding, harmless tab/list probe, and risk diagnostics.
- Pattern verdict stays deferred until the production slice exists and a second map/proof path is real.

## Open Questions

- Does `agent-browser` expose a stable session/CDP binding command, or does proof need a wrapper probe?
- Which harmless action is safest across logged-in pages: tab list, snapshot, or no-op page metadata?
- Should auto-launch be a blocking diagnostic or an explicit operator override?
