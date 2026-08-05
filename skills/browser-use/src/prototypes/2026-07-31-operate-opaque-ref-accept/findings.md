# Acceptance receipt — PR #284 operate opaque-adapter-ref fix (2026-07-31)

**Lane:** post-build (accept). **Verdict: PASS, falsifiable.**

Proves the implemented fix does what the plan promised: `browser-use operate`
now resolves an **agent-browser** target by its native `t1`-style tab ref and
drives the operation end to end — the exact case that returned
`browser_operation_target_missing` before the fix.

Run against live Agent Chrome (via `browser-connect`), a **served http** fixture
(`http://localhost:8787/login-shapes-fixture.html` — harness discovery is
http-only), through the FIXED worktree CLI (`bun run browser-use` in
`.claude/worktrees/operate-opaque-page-ref/skills/browser-use`). Secret-free.

## Acceptance claim + result

| Step | Call | Result |
|------|------|--------|
| 1 | `browser-use targets list --mode handoff-bound --handoff <env>` | ok, 1 candidate (`http://localhost:8787`) |
| 2 | `targets select --candidate 1 --state <state>` | ok |
| 3 | `operate snapshot --handoff <env> --state <state>` | **ok** — snapshot contains the page's Password field (operation actually executed) |

Tab id was confirmed `t1` (the string ref that broke the pre-fix integer path).

## Falsifiability (the test goes red on old code)

Same call sequence, same `t1` target, same fixture, through **main's pre-fix**
`browser-use`:

- Pre-fix (`main`): `operate snapshot` → **`error: browser_operation_target_missing`**
  ("The resolved Browser Target no longer carries an adapter page handle") — the
  original `parseAdapterPageId` integer-rejection of the `t1` ref.
- Post-fix (`PR #284` worktree): `operate snapshot` → **`ok`**.

Red on old, green on new → the fix specifically closed the bug; the PASS is not
vacuous.

## What the fix did (confirmed in source)

`browser-use-operations.ts` splits the lane by adapter: the **agent-browser**
lane now accepts the native string tab ref (`SAFE_TAB_ID.test(adapterPageRef)`)
and drives via `agent-browser --cdp <ws> --session browser-use-<runId>`; only the
**chrome-devtools** lane keeps the integer pageId. This is the opaque-adapter-ref
split the handoff called for — each lane interprets its own native ref instead of
the harness forcing one shape.

## Graduation

Post-build PASS → the operate opaque-ref fix is proven end to end for the
agent-browser lane. Attach this receipt to PR #284's verification. No gap → no
bug filed, no plan revision. This also unblocks the through-harness adapter demo
that the `t1` bug originally prevented.

Throwaway; captured as a worked example of the prototyper's **post-build** lane.
