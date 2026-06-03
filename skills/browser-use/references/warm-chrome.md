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

- Warm Chrome CLI: `skills/browser-use/scripts/preflight-warm-chrome.sh`.
- Warm Chrome runtime: `skills/browser-use/scripts/preflight-warm-chrome.ts`.
- CLI contracts: `skills/browser-use/scripts/command-contract.ts`.
- Focused tests: `skills/browser-use/scripts/preflight-warm-chrome.test.ts`.

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
