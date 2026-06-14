# U6 review - Make writes and subprocesses failure-contained

- Run: `20260613-u6u7` (focused increment) · base `38ab9f7` · verdict **clean (P3 only)**
- Owner files: skill-feedback-runner.ts, skill-feedback.test.ts, hooks/skill-feedback-runtime.ts, hooks/skill-feedback-hooks.test.ts, references/report-shape.md
- Requirements: R19, R20, R21, R24

## Verdict: met

- **Atomic write (R19)** - `writeAtomicPrivateFile` (runner:1790) uses `open(wx)` (O_EXCL) → write → chmod → `link()` (hardlink) → `unlink(temp)` in finally. The final path appears only via the last atomic `link()`, so a partial `.json` at the final path is genuinely impossible.
- **Write-failure envelopes (R20)** - `record_write_failed` / `closeout_write_failed` set `changedState: "partial"` when rollback fails, `"none"` when rollback is clean (runner:284-289, 410-439). Correct three-way on closeout. Because the writer is atomic, `"partial"` is effectively unreachable in production wiring - it surfaces only under a non-atomic stub. Conservative and correct.
- **Subprocess timeouts (R21)** - both spawn sites (`git rev-parse HEAD` runner:141, `git check-ignore` runner:147-148) route through `runProcess` with the 6s `DEFAULT_RUNNER_PROCESS_TIMEOUT_MS`. Bounded.

## Findings

- **#1 (P3, was P2 - downgraded)** - `runProcess` timeout sends `child.kill()` (SIGTERM) once then awaits `child.exited`, no SIGKILL escalation (runner:2234). Real severity is low: the only spawned commands are `git rev-parse` / `check-ignore`, which die on SIGTERM. Confidence 100 that this is a non-issue in practice. Escalate to SIGKILL after a grace window only if a signal-trapping subprocess is ever added. **No change required for merge.**
- **#13 (P3, new, gated_auto)** - dead `linked` variable in `writeAtomicPrivateFile` (runner:1799), set after `link()` but never read; the finally only branches on `handle`. Cleanup, no behavior change.

## Hook timeout alignment - done, not skipped

U6 named `hooks/skill-feedback-runtime.ts` as an owner, but the file is **unchanged**. This is correct: "keep hook subprocess timeout aligned with runner" was satisfied by the **runner adopting the hook's existing 6s / SIGTERM-once / exit-124 pattern**, not by editing the hook. Both timeouts are `6_000` with identical logic.

**Residual risk:** the two `6_000` values match coincidentally (no shared constant). A future edit to one could silently diverge. Consider a single exported `SKILL_FEEDBACK_SUBPROCESS_TIMEOUT_MS` constant shared by runner and hook.

## Testing gaps

- No test for `writeAtomicPrivateFile` `link()` EEXIST collision (throw → unlink temp → `changed_state: none`).
- No test forcing rollback `"failed"` against the real atomic writer to confirm `"partial"` is production-unreachable (only the injected non-atomic stub reaches it).
