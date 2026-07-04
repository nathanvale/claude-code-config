# Warm Chrome

Operational map for browser entry.

## Invariant

- Use real Google Chrome.
- Use a dedicated persistent profile.
- Use loopback CDP.
- Avoid Chrome for Testing.
- Avoid throwaway profiles.
- Avoid the everyday default Chrome profile.

## Owners

- Warm Chrome front door: `skills/browser-use/package.json#bin` (`preflight-warm-chrome`).
- Warm Chrome runtime: `@side-quest/warm-chrome` (`runtime/warm-chrome`). The
  front door `skills/browser-use/src/preflight-warm-chrome.ts` is a thin
  delegator to its `main()`; proof, station, and reason behavior are owned there
  (`runtime/warm-chrome/AGENTS.md`).
- CLI contracts: `skills/browser-use/src/command-contract.ts` (adapter proof,
  map, router); the Warm Chrome command contract is package-owned.
- Focused tests: `runtime/warm-chrome/tests/` (station + proof suites).

## Operation

- Run Warm Chrome Preflight before browser adapter work.
- Treat preflight stdout as endpoint authority.
- Treat stderr as diagnostics.
- Follow the emitted continuation.
- Use `status` for human health checks.
- Use `repair` or `launch` only when browser entry is approved or requested.

## Boundaries

- Browser Adapter Router owns adapter selection.
- Browser Adapter Proof owns selected adapter attachment.
- Adapters consume Warm Chrome proof.
- Auth/login walls are app steps after browser entry succeeds.
- Historical findings and rationale live in `skills/browser-use/PROVENANCE.md`.
