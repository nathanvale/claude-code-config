# Auth-context generic-login route findings

Lane: `browser-use-prototyper` pre-build falsification. Real Agent Chrome through
a verified `browser-connect` endpoint. Localhost fixtures only. Dummy credential
values only. This spike proves the Agent Chrome route only; no adapter-neutrality
claim.

## Question

Can one secret-free run carrying a Runbook with `auth_context_ref` enter the
existing generic login engine, preserve its run/handoff identity, and dispatch
the first business step only after authentication succeeds?

## Exact call sequence

```text
cd skills/browser-use
bun run prototype:auth-context-generic-login-route
```

The runner internally:

1. `browser-connect connect agent-browser --json` → consumes the verified `ws`
   endpoint (observed `ws://127.0.0.1:9242/...`; never a convention port).
2. Serves each fixture over an ephemeral `http://127.0.0.1:<port>` (never
   `file://`).
3. Mints one run id from the runbook (`route-<service>-<flow>`), carried through
   engine input and the post-auth business dispatch.
4. Reads the business counter BEFORE auth, runs the production
   `runBrowserUseLoginEngine` (with `createBrowserUseCdpObserver`,
   `mintBrowserUseVerifiedTarget`, dummy `deliver`/`tokenRetrieval` seams), reads
   the counter AFTER auth, then dispatches the business step only on success.
5. Closes every fixture tab.

The Runbook fixture carries `auth_context_ref` and one business step
(`{role:"button", name:"Submit timesheet"}`); it contains no username, password,
or OTP steps. Login choreography lives entirely in the engine (ADR 0032/0033).

## Results

| Shape | engine_ok | business before / after-auth / after-dispatch | run identity | verdict |
| --- | --- | --- | --- | --- |
| multistep-then-business | true | 0 / 0 / 1 | resume id == run id | PASS |
| ambiguous-near-miss | false (`human-identity-attestation-required`) | 0 / 0 / 0 | resume id null | PASS |

Overall verdict: **PASS**.

- Positive: business counter is 0 before and during authentication, becomes
  exactly 1 only after the engine reports success and the business step
  dispatches. The same run id resumes the run after auth. Signed-in marker
  present.
- Planted near-miss: the ambiguous unlabelled login shape returns the existing
  fail-closed `human-identity-attestation-required` result before any write; zero
  business dispatch, run identity not resumed.

## What this proves

- A Runbook's declarative `auth_context_ref` is a sufficient entry point into the
  existing generic login engine; the runbook needs no login steps.
- Run/handoff identity is preserved across the auth boundary — the same id enters
  the engine and resumes the business dispatch.
- Business dispatch is strictly ordered after authentication success. A
  fail-closed auth result yields zero business effect.
- The minimum throwaway routing glue is: mint run id from runbook → engine →
  dispatch-on-success. No production source change was required to prove the
  route.

## Limits

- Agent Chrome route only. No adapter-neutrality claim (playwright-cdp /
  chrome-devtools-mcp not exercised here).
- Dummy delivery through the real engine seams; the confidential-delivery
  receipts own real custody and leak-sweep proof.
- The business step is a fixture marker (one labelled control), standing in for
  the runbook execution boundary above the engine. Real runbook step execution
  and its own target-proof discipline remain product work.
- Run identity here is a carried string, not the full Shared Browser Use Run
  lifecycle (`browser-use-run-model.ts`); wiring the engine route through the run
  integration Port remains product work.

## Plan effect

- Confirmed: the accepted dependency order (generic login engine before Reviewed
  Action / Private Runbook authoring) is safe — the auth route already works
  against real Chrome with a declarative `auth_context_ref`.
- Acceptance criterion for the login-engine product wiring: a runbook carrying
  only `auth_context_ref` must enter the engine, preserve run identity, and gate
  the first business step behind auth success, failing closed otherwise.
- Open (named, not silently assumed): binding lookup from `auth_context_ref`,
  public task/command routing, and Shared Browser Use Run integration remain
  unproven product wiring, tracked separately.
