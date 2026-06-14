# Review index — plan 003 skill-feedback merge-readiness

Watch-loop review of `docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md`.
Another agent implements; this loop reviews each unit as its `## Execution Progress` checkbox flips.
Findings only — no code edits by the watcher.

## Status — COMPLETE

- Units reviewed: **U1-U7** (all). Run `20260613-982f71e0` (U1-U5) + `20260613-u6u7` (U6/U7 increment).
- Overall: **Ready with fixes** — no P0/P1/P2-blocker; 14 P2/P3 findings, mostly the new purge surface.
- Trust boundary, purge containment, write atomicity, and cross-lane claim boundary all proven sound.

## Files

- `WATCH-STATE.md` — loop state, unit→owner-file map, review ledger
- `U1-findings.md` — trust boundary (clean)
- `U2-findings.md` — redacted anchors (clean)
- `U3-findings.md` — low-signal lane (clean, 1 P3)
- `U4-findings.md` — inbox reads + gated purge (the actionable cluster)
- `U5-findings.md` — review actions + renderer (clean, 1 agent-native gap)
- `U6-findings.md` — writes + subprocesses failure-contained (clean, P3 only)
- `U7-findings.md` — cross-lane e2e + reference alignment (clean, P3 only)
- Raw reviewer JSON + synthesized `review.json`: `/tmp/compound-engineering/ce-code-review/20260613-982f71e0/` and `/tmp/compound-engineering/ce-code-review/20260613-u6u7/`

## Top of the fix queue (for the implementing agent)

All P2/P3 — none block merge by themselves, but the U4 purge cluster is the real signal:

1. **#3** purge `--older-than` preview/execute cutoff divergence — document or freeze candidate list.
2. **#4** purge `--lane low-signal` deletes content-classified reports in the primary dir — document logical-lane semantics.
3. **#5** purge `--keep-latest` + default `--lane all` wide blast radius — warn or require explicit lane.
4. **#7** orphaned `.tmp-*` GC — add cleanup under `--execute`.
5. **#9** export `SkillFeedbackPurgeResultData` + parser to command-contract.ts (3 reviewers).
6. **#1/#2** subprocess SIGKILL escalation (U6 territory) — defense-in-depth.
7. Testing gaps: forged `runtime_owned` strip proof; purge partial-delete, `--lane all` execute, keep_latest execute, delete-time symlink escape.
8. project-standards: purge test asserts raw literals instead of package constants.
9. agent-native: no `resolve-ref`/`show` command for `report:<id>` refs; `--lane` default not in help.

## Post-fix status

- Fixed: `--older-than` execute-time semantics documented.
- Fixed: logical low-signal lane semantics documented.
- Fixed: `SkillFeedbackPurgeResultData` exported with parser.
- Fixed: forged `runtime_owned` normalization proof.
- Fixed: purge partial-delete, `--lane all --execute`, and `keep_latest` execute tests.
- Fixed: low-signal newest timestamp assertion.
- Fixed: purge contract literals replaced by package constants.
- Fixed: purge failure envelope includes `deleted_paths`.
- Fixed: `--lane` default shown in help.
- Fixed: review result schema bumped to `"3"` and recorded in `docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md`.
- Fixed: `report:<id>` lookup path documented; resolver command deferred by accepted decision.
- Fixed: low-signal reason ids derive per report.
- Deferred: orphaned `.tmp-*` GC; review reports temp artifacts as invalid inbox health until a separate temp-GC contract decision.
- Accepted: hook and runner subprocess timeout constants stay local until a third owner or drift bug creates extraction pressure.

## What's proven solid (do not re-litigate)

- U1 trust boundary: forged provenance cannot reach `corroborated`/`same_trusted_run`/`trusted_engine_identity` (security + correctness + adversarial all refuted their own break attempts).
- Purge containment: cannot delete outside `.skill-feedback/` (per-candidate lstat+realpath at delete time).
- Redacted paths stay weak/unmergeable; atomic write is O_EXCL + hardlink; JSON output structurally safe.
