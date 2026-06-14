# U4 review — Harden inbox reads and add gated purge

- Run: `20260613-982f71e0` · base `38ab9f7` · verdict **met with caveats** (the actionable cluster)
- Owner files: command-contract.ts(+test), skill-feedback-runner.ts, skill-feedback.test.ts, references/report-shape.md, references/redaction.md, SKILL.md
- Requirements: R7, R10, R17, R18, R22, R23, R24

## Verdict: met with caveats — containment is sound, UX has footguns

**Containment is correct** (security + adversarial confirmed):
- Inbox scanner classifies primary / low-signal / legacy-low-signal / skipped-unsafe / invalid before normalization; review never follows symlinks and continues over valid reports when unsafe/invalid present.
- Purge: preview-default, `--execute` gated, exactly-one retention selector enforced (`--execute` alone → exit 2, no write), per-candidate `lstat` + `realpath` containment **re-checked at delete time** (`assertSafePurgeCandidate`, runner:1612-1626), `removeFile` is `unlink`-only. Cannot delete outside `.skill-feedback/`.

The findings below are **UX/least-surprise**, not containment breaches — every deleted file stays inside `.skill-feedback/`.

## Findings (the actionable cluster)

- **#3 (P2)** — `purge --older-than` recomputes the cutoff with a fresh `runtime.nowIso()` at execute (runner:628). Preview and execute are separate CLI calls, so a report 13d23h old at preview ages past a 14d cutoff before execute and is deleted though **preview never listed it**. Fix: document `--older-than` as execute-time-evaluated, or freeze + verify a candidate-list token from preview.
- **#4 (P2)** — `purge --lane low-signal --execute` deletes content-classified Codex Stop reports physically in the **primary** dir, not just `low-signal/` (runner:925-927: lane is logical-by-content, `selectPurgeCandidates` filters on it). Intended per R7/R23 (legacy unknown-skill is low-signal by content), but `--lane low-signal` reads as "the directory." Fix: document low-signal as a logical content lane spanning both dirs, or surface physical-dir vs logical-lane in preview.
- **#5 (P3)** — `purge --keep-latest` with default `--lane all` slices newest-N across **both lanes combined**; one `--execute` can wipe the inbox to a single report. Fix: warn when candidate_count is a high fraction of scanned_count, or require explicit `--lane` for keep_latest execute.
- **#7 (P2, shared U6)** — orphaned `.tmp-*` files from a crash between `open()` and `link()` accumulate; the scanner counts them invalid but nothing GCs them. Fix: add a purge sub-path / cleanup unlinking `.tmp-*` older than a threshold under `--execute`.
- **#9 (P2, 3 reviewers)** — `SkillFeedbackPurgeResultData` is a private runner type for a public contract envelope; no exported parser unlike `ReviewResultData`. Fix: move to command-contract.ts + add parse path.

## Standards + agent-native

- **project-standards P2** — `skill-feedback.test.ts:2792` asserts `"skill-feedback.purge"` / `"1"` as raw literals; should import `SKILL_FEEDBACK_PURGE_CONTRACT_ID` / `SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION` (facade rule: assert package-owned vocabulary from constants). Mechanical.
- **agent-native** — `purge_delete_failed` envelope omits `deleted_paths` at the failure point; an agent hitting partial-delete can't compute the delta. `--lane` default `all` not stated in flag description.

## Testing gaps (U4 priority before merge)

- No test: partial-delete failure (`changed_state: partial`), `--lane all --execute` spanning both dirs, `keep_latest` execute integration, delete-time realpath-escape landing in `skipped_paths`, low-signal subdir symlink refusal.
