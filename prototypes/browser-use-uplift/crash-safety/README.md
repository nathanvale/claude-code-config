# crash-safety

## Question

When an agent re-drives or captures a browser flow (e.g. "submit timesheet"), the run can DIE mid-flow: a crash, the browser closes, the network drops, or a flaky widget never fires. The danger is a half-finished capture being persisted as a runbook, so a FUTURE run replays a CORRUPTED/partial runbook — clicking some buttons but not others, or doing the wrong thing entirely.

Can a COMMIT BOUNDARY guarantee that durable memory is written ONLY when a run COMPLETES and its success-verification passes (`confirmed`) — so a crashed/partial run leaves NO poisoned partial behind, and a crash mid-OVERWRITE never clobbers a known-good runbook? Like a DB transaction that rolls back on failure.

## How to run

```bash
bun prototypes/browser-use-uplift/crash-safety/crash-safety.ts
```

No browser, network, real files, or `Date.now()`. Durable memory and the scratch journal are in-memory objects; a "crash" is a thrown error partway through a run, caught so we can prove scratch is abandoned. Deterministic. Pure TS, zero deps.

## Design

- A run captures steps into its OWN **scratch journal** (a local). Crashing throws the journal away; it never touches durable.
- The **commit boundary** stages to scratch, then runs the three-way success gate (`confirmed` / `failed` / `ambiguous`, reused from the success-verify sibling). It promotes ONLY on `confirmed`.
- **Atomicity**: the new runbook is built fully in scratch, and the durable reference is swapped in a single `durable.set(...)`. Durable is never mutated in place, so a crash can't leave it half-written.
- An explicit invariant assertion runs after every scenario: durable holds EITHER the previous good runbook OR a fully-complete verified one — never a partial (checks `complete`, contiguous step indices, non-empty).

## Verdict

Commit boundary holds. Across all five scenarios, durable memory only ever contained a fully-complete, verified runbook or the previous good one — NEVER a partial. The invariant assertion passed every time.

Actual run output:

```
[1] Clean complete + confirmed
   committed=true (confirmed after 6 steps)
   durable after: 6 steps, complete=true
   INVARIANT ✓ durable[hr.example.com/timesheet] = complete runbook (6 steps, confirmed after 6 steps)

[2] Crash mid-flow (dies at step 3 of 6) on a NEW domain
   committed=false (discarded scratch — run died at step 3/6 (fill Tuesday hours))
   durable[payroll.example.com/leave] after: <empty>
   INVARIANT ✓ durable[payroll.example.com/leave] empty (no partial persisted)

[3] Completed run, verification = ambiguous (spinner stuck)
   committed=false (verification=ambiguous — scratch discarded, durable unchanged)
   durable[payroll.example.com/leave] after: <empty>
   INVARIANT ✓ durable[payroll.example.com/leave] empty (no partial persisted)

[4] Crash mid-OVERWRITE of an existing good runbook (dies at step 4 of 6)
   committed=false (discarded scratch — run died at step 4/7 (fill rest of week))
   durable[hr.example.com/timesheet] after: 6 steps, complete=true
   known-good runbook survived intact (same reference, 6 steps): true
   INVARIANT ✓ durable[hr.example.com/timesheet] = complete runbook (6 steps, confirmed after 6 steps)

[5] Clean overwrite + confirmed (new longer flow replaces the old one)
   committed=true (confirmed after 7 steps)
   durable[hr.example.com/timesheet] after: 7 steps, complete=true
   reference swapped (no in-place mutation): true
   INVARIANT ✓ durable[hr.example.com/timesheet] = complete runbook (7 steps, confirmed after 7 steps)
```

## Findings for browser-domain-memory

- **Capture is a transaction, not a stream of writes.** Steps accumulate in a scratch journal that is never read by replay. Durable memory is touched at exactly one point — the commit — so there is no window where a partial is visible.
- **Two independent gates guard the commit, both fail-closed.** A crash never reaches verification (scenario 2). A completed-but-unconfirmed run reaches verification and is rejected (scenario 3, `ambiguous`). Only the `confirmed` path promotes. `failed`/`ambiguous` behave identically to a crash from durable's point of view: nothing changes.
- **Overwrite must stage-then-swap, never mutate in place.** Scenario 4 proves a crash mid-overwrite leaves the previous known-good runbook byte-for-byte intact (verified by reference identity and step count). If capture had appended into the live runbook, the crash would have left a longer-than-real, half-valid runbook — exactly the poison this boundary prevents.
- **The invariant is cheap to assert and worth asserting.** `complete && contiguous-indices && non-empty` catches any leak. Wire an equivalent check into the real promote step so a regression fails loudly instead of silently persisting a partial.
- **Implication for the real system:** model the durable store as content-addressed or atomically-renamed (write to a temp/scratch path, then atomic rename/swap). Never `append`/`patch` a live runbook during capture. Treat `confirmed` from the success-verify layer as the ONLY promotion trigger.
