# Warm Chrome

Operational map for the Warm Chrome invariant and auth boundary. Browser
entry front door: `runtime/browser-connect`.

## Invariant

- Use real Google Chrome.
- Use a dedicated persistent profile.
- Use loopback CDP.
- Avoid Chrome for Testing.
- Avoid throwaway profiles.
- Avoid the everyday default Chrome profile.
- Never hardcode the convention endpoint `http://127.0.0.1:9222`; take the verified endpoint from the browser-connect envelope.

## Owners

- Browser entry front door: `runtime/browser-connect` (`@side-quest/browser-connect`) — `check`, `connect`, `run`, `repair-adapter`; contract: `runtime/browser-connect/src/command-contract.ts`; repair procedures: `runtime/browser-connect/REPAIR.md`.
- Environment proof runtime: `@side-quest/warm-chrome` (`runtime/warm-chrome`), consumed in-process by browser-connect; proof, station, and reason behavior are owned there (`runtime/warm-chrome/AGENTS.md`).
- Targets and operations contracts: `skills/browser-use/src/command-contract.ts`.
- Focused tests: `runtime/warm-chrome/tests/` (station + proof suites).

## Operation

- Connect through browser-connect before any Browser Adapter acts; adapters never find Chrome themselves.
- Treat the JSON envelope as endpoint authority (`connect`/`check`: stdout; `run`: stderr pre-exec).
- Treat stderr diagnostics as diagnostics.
- Follow the emitted continuation; failure envelopes carry one Repair Path with an anchor into `runtime/browser-connect/REPAIR.md`.
- On exit `20`, fail closed: no cold or headless fallback, no convention-port retry.

## Boundaries

- browser-connect owns connection: environment proof, endpoint injection, adapter attachment.
- browser-use owns operational policy after the handoff: adapter capability policy, targets, operate.
- Auth/login walls are app steps after browser entry succeeds.
- Historical findings and rationale live in `skills/browser-use/PROVENANCE.md`.
