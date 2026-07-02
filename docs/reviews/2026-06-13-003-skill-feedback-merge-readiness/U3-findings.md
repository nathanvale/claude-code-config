# U3 review - Add the low-signal capture lane

- Run: `20260613-982f71e0` · base `38ab9f7` · verdict **clean with one P3**
- Owner files: hooks/skill-feedback-codex-stop.ts, hooks/skill-feedback-runtime.ts, hooks/skill-feedback-hooks.test.ts, command-contract.ts(+test), skill-feedback-runner.ts, skill-feedback.test.ts, references/report-shape.md, CONTEXT.md
- Requirements: R6-R10, R24

## Verdict: met

- New Codex Stop captures with `unknown-skill` + no trusted identity route into `.skill-feedback/low-signal/` (runner:250).
- Review classifies **both** the low-signal lane and legacy top-level `unknown-skill` Codex Stop reports as low-signal by content before ledger reduction (runner:767-768).
- `inbox_health` summary carries `low_signal_count`, newest ts, reason ids - machine-readable, schema-validated.
- Lane stays inside `.skill-feedback/` so ignore/privacy gates apply.

## Findings touching U3 owners

- **#10 (P3 advisory, 4 reviewers)** - `low_signal_reason_ids` is hardcoded to the single `unknown_skill_codex_stop` constant whenever any low-signal report exists (runner:1173), rather than derived per report. A report low-signal by physical lane but not by the Codex-Stop classifier would be mislabeled. The type (`string[]`) already admits diversity, so extending the derivation needs no contract change. Acceptable pilot simplification; correctness + api-contract + maintainability + agent-native all noted it.

## Agent-native note

`low_signal_newest_generated_ts` value is never asserted in tests (only count + reason_ids). Add an assertion that it equals the lexicographically-last `generated_ts` among low-signal reports.
