# Browser Adapter Replay Simulator

PROTOTYPE - throwaway.

## Question

When Browser Adapter Proof fails, does the Browser Adapter Map recovery loop converge to a verified adapter handoff, warning-only success, or a clean stop?

## Run

```bash
bun skills/browser-use/scripts/prototype-browser-adapter-replay-simulator/prototype.ts
bun skills/browser-use/scripts/prototype-browser-adapter-replay-simulator/prototype.ts --auto
```

## Files

- `prototype.ts`: interactive in-memory replay simulator.
- `NOTES.md`: captured learning and production-shape candidates.

## Delete

- Delete this folder after the replay-loop answer is captured in production code, an ADR, or the implementation plan.
