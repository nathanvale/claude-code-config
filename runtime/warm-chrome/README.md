# warm-chrome

Warm Chrome browser-entry proof runtime: prove the agent is attached to the
correct warm Chrome — real browser, dedicated profile, loopback CDP,
browser-level websocket, listener/profile/port consistency — or fail with a
repair path before any adapter acts.

Package docs: `AGENTS.md` routes maintainers, `ARCHITECTURE.md` owns the
module map and flows, `CONTEXT.md` owns vocabulary, and `TASKS.md` tracks
active and deferred work.

## Commands

```bash
warm-chrome check    # agent proof, JSON default
warm-chrome status   # presentation alias of check, plain default
warm-chrome launch   # spawn + verify warm Chrome
warm-chrome repair   # repair dedicated profile state
```

Unlinked environments run the same commands through Bun:

```bash
bun run runtime/warm-chrome/src/cli.ts check --json
```

No-arg `warm-chrome` shows help. `warm-chrome help [command]` renders the same
help as `--help`.

## Inputs

- `--port`: CDP port. Mutually exclusive with `--endpoint`.
- `--endpoint`: numeric loopback endpoint, `http://127.0.0.1:<port>`.
- `--profile`: dedicated profile. `check`/`status` verify it; `launch` may
  create/chmod it; `repair` may create, chmod, or rewrite proof state in it.
- `--chrome`: `launch` only; accepted binary path is
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Global diagnostics: `--run-id`, `--quiet`, `--verbose`, `--debug`.

Environment fallbacks: `WARM_CHROME_CDP_PORT`, `WARM_CHROME_PROFILE_DIR`,
`WARM_CHROME_RUN_ID`, and `CHROME_BIN` (`launch` only).

## Authority

- Charter: `docs/decisions/2026-07-03-warm-chrome-runtime-package-definition.md`
- Runtime contract: ADR 0009 (+ 2026-07-03 amendment)
- Plan: `docs/plans/2026-07-03-001-feat-warm-chrome-runtime-package-plan.md`
- Port source (stays authoritative until the parity switchover):
  `skills/browser-use/src/preflight-warm-chrome.ts`

The ok envelope is the only endpoint authority: consumers take the verified
endpoint and browser-level websocket URL from it and never derive the endpoint
from the `9222` convention.
