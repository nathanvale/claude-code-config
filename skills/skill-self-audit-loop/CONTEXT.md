# Context: skill-self-audit-loop

Project-specific vocabulary for the skill self-audit loop. Glossary only — no workflow steps, no implementation.

## Trust condition

The single reason a test result is believable instead of theater. Answers "why should I trust that this passed?" Every proof method names exactly one. A method with no trust condition proves nothing.

The four trust conditions:

- **Oracle** — the right answer was known in advance, so the result can be graded against ground truth.
- **Independence** — separate judges reached the same result without sharing context or colluding.
- **Adversarial** — someone was incentivized to break it and failed.
- **Falsifiability** — there was a defined way the result could have failed; it did not.

## Earned method

A proof method that has been run at least once against a real loop change and produced a trust-condition-backed verdict — whether it caught a problem or confirmed clean. Both outcomes count; a confirm-clean run still proves the method met reality. The opposite is a candidate (or unearned) method: plausible but never run, kept as a named slot, not a trusted tool. The gate exists to keep untested methods out of the catalog.

One real run earns a method. This is a lower bar than shape promotion on purpose — they answer different questions.

## Shape promotion

Adding a new accepted contradiction shape to the accepted shapes (the Contradiction Rule in SKILL.md owns that list). A candidate shape (an out-of-shape conflict) earns promotion only when it recurs across multiple audits and survives a fresh proof run. Earning a method asks "is this tool real?" (one run). Promotion asks "is this pattern worth a permanent shape?" (recurrence). Keep the two thresholds separate.

## Out-of-shape

A real contradiction (two sources that genuinely cannot both be followed) that matches no accepted shape. Distinct from rejected: rejected means "not a real conflict" (style, taste, vagueness); out-of-shape means "real conflict, but no shape covers it yet." It lives in the loop file's Candidate Shapes section as evidence toward a future shape promotion, never discarded as a style nit.

## Metamorphic relation

A proof shape that checks how the output should change when the input changes, instead of checking one correct answer. Use it when there is no oracle — when the right answer is a judgment call, not a known value. Example: re-auditing an already-converged loop must add zero new findings; the relation (same input, same verdict) holds even though no single "correct" finding count was known in advance. Borrowed from metamorphic testing in software, used where ground truth is unavailable.
