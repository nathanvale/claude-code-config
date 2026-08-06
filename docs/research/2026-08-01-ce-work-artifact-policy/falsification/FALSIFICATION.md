# Falsification experiment result

Executed 2026-08-01. Experiment root: `/private/tmp/ica-artifact-policy-falsify.f72092`.

## Verdict

**Not falsified.** 96/96 checks pass (`report.json`).

Criterion tested: resume must produce one idempotent receipt without deleting
unowned state or falsely claiming `canonical_ignored_state_preserved`. It held
at every injection point and fixture.

## Method

Wired the Artifact Policy Module into a disposable copy of the runtime-current
controller (plugin cache `compound-engineering 3.21.0`,
`unit_workspace_transaction.py::_verify_run_locked`), leaving routing, lock
machinery, and Git integration unchanged. The wiring adds:

- A durable phase record (`artifact-phase-<attempt>.json`, atomic write) holding
  serialized policy, `PreciousRecord`s, custody root, parent modes, regenerable
  stat manifest, and the precious start digest.
- Five crash points, injected as hard `os._exit(21)` via `CE_WORK_TEST_FAULT`
  + `CE_WORK_FAULT_MODE=hard` (extending the controller's existing
  `test_fault` convention):
  1. `artifact-after-reclassify`
  2. `artifact-during-precious-capture` (inside the custody copy loop)
  3. `artifact-before-precious-restore`
  4. `artifact-after-restore-before-receipt`
  5. `artifact-after-receipt-before-release`
- `artifact-resume`: rebuilds custody from the phase record, restores precious
  idempotently, recomputes divergence, records exactly one receipt per
  transaction id, reference-counts orphan custody debris, releases the lock.

A synthetic `native-completed` unit (valid per `_native_completion_commit`)
made the real `verify-run` transaction drivable: lock acquire, attempt record,
subprocess verification, semantic restore, receipt, release all ran unmodified.

## Fixtures and results

| Fixture | Result |
|---|---|
| Bun root link farm + package-local `node_modules` + precious override inside `node_modules` | Baseline passes as `VERIFIED_WITH_REGENERABLE_DIVERGENCE`; precious restored byte-exact; regenerable change/delete/introduce left in place; bun + project-build repair argv emitted; receipt refuses preservation claim. |
| 5 hard-crash points × resume (link-farm fixture) | Lock retained by crash, released by resume; precious intact; points 3–4 produce exactly one resume receipt; point 5 produces no second receipt; points 1–2 produce no phantom receipt and leave the repo untouched; second resume is a no-op; fresh verify-run succeeds after every recovery. |
| Crash-window mutation (mutate `dist` between crash 4 and resume) | Disclosed as divergence; no false preservation claim. |
| pnpm hardlinks | Regenerable hardlinks into an external store admitted; precious file with external hardlink alias refused pre-verification, nothing mutated, lock released. |
| Opaque nested repository | Refused as unsupported precious entry type; nested repo untouched. |
| Transport-added `.gitignore` change | Advisory saw 1 entry; authoritative reload reclassified `generated/cache.bin` as unknown-precious, captured and restored it exactly. |
| Introduced unknown precious | `BLOCKED_PRECIOUS_RESTORATION`, receipt recorded and truthful, file preserved, lock released, dispatchable after owner inspection. |

## Findings beyond the pass

1. **The durable phase record is load-bearing and implementable.** All custody
   state (`PreciousRecord`, parent modes, stat manifest, policy document)
   round-trips through JSON. The prototype's in-memory-only custody cannot
   survive a crash; production must journal at capture time. Confirms the
   handoff's medium-confidence item.
2. **Journaling order gap at crash point 2.** A crash mid-capture leaves an
   orphan custody directory with no phase-record anchor. Safe because custody
   dirs live under the controller-private jobs dir and hold only copies;
   resume removes unreferenced ones. Production should write a `capturing`
   journal entry naming the custody root before the first byte is copied.
3. **Resume receipts must not claim verification results.** The resume receipt
   records `verification_exit: null` plus a blocker requiring re-run. Any
   design that lets resume mark verification passed would be falsified by
   crash points 3–4.
4. **Directory-snapshot exemption must be symmetric.** Introduced precious
   paths exempt their parent directories from the post-restore directory
   proof; the before-snapshot must be filtered identically or restoration
   proof spuriously fails and wedges the lock. Found and fixed during wiring —
   name this in the integration plan.
5. **Mutation attribution stays out of scope, safely.** A mutation landing in
   the crash window is disclosed as divergence but not attributed to an actor.
   Matches the handoff's low-confidence note; behavior is safe (disclose,
   never claim preservation) without attribution.

## Residuals (untested)

- `cmd_integrate` transport window: reclassification-after-transport was
  emulated by committing the `.gitignore` change before verify-run; the
  cherry-pick-then-reload path and integrate-specific crash points
  (`before-canonical-commit`, post-commit finalization) were not wired.
- Windows metadata, cross-platform link semantics, privileged adversaries.
- Scale: fixtures are KB-sized; the warm 68 MB fixture was only probed
  read-only (see HANDOFF.md).

## Artifacts

- `/private/tmp/ica-artifact-policy-falsify.f72092/controller/` — wired disposable controller
- `/private/tmp/ica-artifact-policy-falsify.f72092/harness.py` — fixtures, crash matrix, assertions
- `/private/tmp/ica-artifact-policy-falsify.f72092/report.json` — 96 check results
