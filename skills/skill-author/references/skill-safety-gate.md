# Skill Safety Gate

Use when adding or reviewing safety gates, gotchas, private data boundaries, destructive actions, wrong authority, or external side effects.

## Safety Gate

- Default: harden from refinement evidence.
- Add skill gotchas only when refinement evidence reveals a repeatable, non-obvious miss.
- Treat repeatable as two reproduced task-family misses, or one high-risk first-run case that escalates to a safety gate instead of prose.
- Patch descriptions when routing fails before adding workflow prose.
- If the first bad run could leak private data, mutate durable state, bypass auth, spend money, destroy work, or touch external side effects, add the smallest fail-closed gate before the first run.
- Prefer one-line guardrails, owner paths, dry-runs, redaction rules, or contract checks before new machinery.
- Express safety as model-readable fail-closed bullets.
- Treat stdout/stderr as model-visible; never log secrets, tokens, cookies, or raw auth-bearing URLs.
- Shape-not-value for secrets: inspect presence, length, prefix, newline count; never print values.

## Gotcha Decision

- Record one gotcha decision for every skill create, review, or heal pass: `none found`, `added inline gotcha`, `reused existing guidance`, or `escalated to safety gate`.
- Use the exact label `Gotcha decision:` only in checkable review or handoff artifacts that will run `check-gotcha-decision`.
- In normal final responses, write `Skill follow-up:` instead.
- For `none found`, say: `Skill follow-up: no reusable skill issue found; no user action.`
- For `added inline gotcha`, say: `Skill follow-up: skill updated; added a reusable gotcha for <reason>.`
- For `reused existing guidance`, say: `Skill follow-up: no new gotcha added; reused existing guidance in <owner path> for <reason>.`
- Do not say `existing owner` without naming the file path.
- For implemented safety gates, say: `Skill follow-up: safety gate added; future runs will stop before acting when <condition>.`
- For proposed safety gates, say: `Skill follow-up: safety gate needed; future runs should stop before acting when <condition>; gate not implemented yet.`
- For any outcome other than `none found`, include the refinement evidence class (`observed failure`, `review finding`, `adversarial probe`, or `research`) and one short reason.
- Add a `Gotchas` section only when it contains at least one earned skill gotcha.

## Evidence Loop

Use when improving reusable rules, gotchas, or safety gates after review, research, or a failed run.

1. Pick one skill and one task family.
2. Run a happy path.
3. Run task-family adversarial probes, such as wrong trigger, bad owner path, missing input, invalid flag, stale state, or ambiguous prompt.
4. Record refinement evidence only.
5. Record the gotcha decision.
6. If the user did not already request the specific reusable-rule change, stop with a proposed owner-path change and patch only after user approval.
7. Patch the smallest sentence, command, owner path, safety gate, skill gotcha, or example that would have prevented the failure.
8. Validate frontmatter, examples, and owner commands.
9. Compare before/after on the happy path and failure path.
10. Keep the patch only when it improves the task family against the skill quality bar without bloating the skill.
11. Treat accepted reusable-rule patches as validated reusable rules only after relevant checks pass.
