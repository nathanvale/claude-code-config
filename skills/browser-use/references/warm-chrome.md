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
- Warm stack front door: `browser-use warm start`.
- Warm Chrome runtime: `skills/browser-use/src/preflight-warm-chrome.ts`.
- Warm stack orchestration: `skills/browser-use/src/browser-use-warm.ts`.
- CLI contracts: `skills/browser-use/src/command-contract.ts`.
- Focused tests: `skills/browser-use/src/preflight-warm-chrome.test.ts`.
- Warm stack tests: `skills/browser-use/src/browser-use-warm.test.ts`.

## Operation

- Run `browser-use warm start --json` as the first browser-entry action.
- Treat warm-start stdout as current-run stack readiness.
- Use `preflight-warm-chrome` directly only when isolating Warm Chrome proof, repair, launch, or status.
- Treat preflight stdout as endpoint authority when using the lower-level command.
- Treat stderr as diagnostics.
- Follow the emitted continuation.
- Use `status` for human health checks.
- Use `repair` or `launch` only when browser entry is approved or requested.
- Keep default CDP port `9222`; use `9223` only as stale-port incident/test context.

## Boundaries

- Browser Adapter Router owns adapter selection.
- Browser Adapter Proof owns selected adapter attachment.
- Adapters consume Warm Chrome proof.
- Auth/login walls are app steps after browser entry succeeds.
- Historical findings and rationale live in `skills/browser-use/PROVENANCE.md`.
