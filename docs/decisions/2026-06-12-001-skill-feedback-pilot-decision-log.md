---
title: Skill Feedback Pilot Decision Log
slug: skill-feedback-pilot
type: decision-log
status: in-progress
date: "2026-06-12"
timezone: Australia/Melbourne
owner: skills/skill-feedback
source:
  - skills/skill-feedback/CONTEXT.md
  - docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md
  - "2026-06-12 Codex session: Fallow report-value smoke"
decision_metadata_format: fenced-yaml-per-decision
---

# Skill Feedback Pilot Decision Log

Use this log for accepted decisions about the skill-feedback pilot, report value,
runtime support, and pilot gates.

## Frame

- Treat Software Learning Reports as untrusted evidence.
- Use closeout reports for finding value.
- Use hook capture for proof-of-run.
- Split Codex runtime capture from Trusted skill identity: Codex Stop may be
  runtime-observed evidence, while Codex Trusted skill identity stays gated
  until an engine-owned skill invocation source exists.
- Record accepted pilot gates here.

## Notes

- The 2026-06-12 Fallow smoke produced three v1 closeout reports and one v0 hook-capture report in the local `.skill-feedback/` inbox.
- Closeout reports preserved useful Fallow finding details and resolver verdicts.
- Hook capture proved `fallow` ran without transcript payload, but did not carry finding details.
- Review output surfaced counts and unlinked-correlation spikes, but hid the useful closeout observations.

## Decision 1: Gate Daily Pilot Behind Review And Runtime Proof

```yaml
id: skill-feedback-pilot-001
status: accepted
decided_at: "2026-06-12"
decision: Gate the skill-feedback daily pilot behind review/correlation work, then true Codex end-to-end proof, then pilot start
owner: skills/skill-feedback
source:
  - skills/skill-feedback/CONTEXT.md
  - docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md
  - "2026-06-12 Codex session: Fallow report-value smoke"
decision_mode:
  question: Should the daily pilot start now, wait for true Codex E2E, or fix review/correlation first?
  option: "3 then 2 then 1"
  confidence: strong
```

Decision:

- Fix review and correlation before starting the daily pilot.
- Then prove true Codex end-to-end capture.
- Then start the daily pilot.

Rationale:

- The smoke showed v1 closeout reports are useful for daily triage.
- The smoke also showed review output is too shallow for daily use.
- All reports remained unlinked, so correlation health would dominate review noise.
- Claude Stop hook capture is proven as proof-of-run.
- Codex notify is not proven as live skill capture because the notify payload lacks skill identity.

Consequences:

- Do not claim Codex end-to-end support from the Claude Stop hook smoke.
- Treat Fallow closeout value as proven enough to preserve, but not enough to launch the daily pilot.
- Prioritize richer review output and capture-closeout correlation before pilot usage.
- Historical gate: keep Codex live skill capture gated on a skill identity
  source or equivalent item stream. Decision 44 later split Codex Stop
  runtime-observed evidence from deferred Codex Trusted skill identity.

Next:

- Improve `skill-feedback review` so daily triage exposes closeout observations and actionable report context.
- Add or prove a correlation path between hook capture and driver closeout.
- Re-run the smoke after review and correlation are improved.
- Prove Codex live skill capture before starting the daily pilot.

V2 Ideas:

- Add a report-value score or grouped review view for closeout observations.
- Add a Codex item-stream reader if the notify environment can reach one safely.
- Add a pilot-start checklist command once the gates are satisfied.

## Decision 2: Split Implementation Pilot From Daily Pilot

```yaml
id: skill-feedback-pilot-002
status: accepted
decided_at: "2026-06-12"
decision: Continue an implementation pilot while keeping the daily pilot gated
owner: skills/skill-feedback
source:
  - skills/skill-feedback/CONTEXT.md
  - skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md
  - docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md
  - "2026-06-12 Codex session: implementation-pilot decision"
decision_mode:
  question: What should the next phase be called and allowed to do?
  option: "1"
  confidence: strong
```

Decision:

- Call the next phase the implementation pilot.
- Keep filing closeout reports during v1 implementation, smoke tests, and report-value stress tests.
- Keep the daily pilot gated behind review/correlation work and true Codex end-to-end proof.

Rationale:

- The Fallow smoke showed v1 driver closeouts preserve useful report-card evidence.
- Review output is still too shallow for daily triage.
- Correlation is still noisy because current closeouts are unlinked.
- Claude Stop hook is proof-of-run, but Codex notify is not live skill capture.
- The implementation pilot creates real evidence without overclaiming daily readiness.

Consequences:

- Do not amend Decision 1's daily-pilot gate.
- Treat implementation-pilot closeouts as build evidence and smoke data.
- Do not use implementation-pilot success as proof of Codex live capture.
- Use implementation-pilot reports to shape U4 review and correlation work.

Next:

- Continue v1 `ce-work` from the report-card plan.
- Verify U0 and U1 before moving to U2.
- File closeouts for material skill runs during implementation.
- Use implementation-pilot reports as fixtures for richer review/correlation decisions.

V2 Ideas:

- Add a review lane that labels implementation-pilot evidence separately from daily-pilot evidence.
- Add a pilot mode field if implementation-pilot and daily-pilot records need different review treatment.

## Decision 3: Make review value the next optimization target

```yaml
id: skill-feedback-pilot-003
status: accepted
decided_at: "2026-06-12"
decision: "Make review value the next optimization target"
owner: "skills/skill-feedback"
source:
  - "skills/skill-feedback/docs/brainstorms/2026-06-10-skill-follow-up-feedback-loop-requirements.md"
  - "skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md"
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "2026-06-12 Codex session: deferred queue grill"
```

Decision:

- Optimize the next skill-feedback branch for review value first.
- Make `skill-feedback review` expose observations, owner paths, grouped signals, and next actions before deeper correlation or Codex live capture work.

Rationale:

- The product energy is the morning-review surface.
- Review value makes the inbox worth opening before correlation is perfect.
- The clean-inbox smoke already proves the loop can surface high verification burden, evidence gaps, and owner-path observations.
- Correlation and Codex live capture remain required before the daily pilot starts.

Consequences:

- Treat richer review as the next branch spine.
- Keep correlation work as the next unlock after review value.
- Keep Codex end-to-end proof gated behind a skill identity source.
- Do not claim Daily pilot readiness from implementation-pilot reports.

Next:

- Draft the next brainstorm around review value.
- Stress-test grouped review, report-value scoring, and next-action hints.
- Preserve separate follow-up lanes for correlation, Codex live capture, purge, cost, and repair candidates.

V2 Ideas:

- Add a report-value score for closeout observations.
- Add grouped review by owner path, friction category, and verification burden.
- Add a review lane for implementation-pilot evidence if phase labels become necessary.

## Decision 4: Gate new skill-feedback feature work behind Codex lifecycle-hook proof

```yaml
id: skill-feedback-pilot-004
status: accepted
decided_at: "2026-06-12"
decision: "Gate new skill-feedback feature work behind Codex lifecycle-hook proof"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-12-001-feat-skill-feedback-report-card-v1-plan.md"
  - "https://developers.openai.com/codex/hooks"
  - "2026-06-12 Codex lifecycle-hook smoke"
```

Decision:

- Gate new skill-feedback feature work behind a working Codex lifecycle-hook smoke.
- Prove a real Codex lifecycle hook can execute in this repo before adding new review-value, pilot, purge, cost, or repair-candidate features.
- Keep Decision 3's review-value direction as product strategy, but sequence hook proof first as the implementation gate.

Rationale:

- Latest Codex supports lifecycle hooks, so skill-feedback should use that path instead of old `notify` assumptions.
- The first local smokes proved the hook feature is enabled, but did not prove project lifecycle hooks execute under the tested `codex exec` path.
- Adding feature polish before hook proof risks building on an unproven capture surface.
- The daily-pilot gate already depends on true Codex end-to-end proof.

Consequences:

- Treat Codex lifecycle-hook proof as the next blocking implementation task.
- Do not add new exciting skill-feedback feature branches until a Codex hook smoke writes an inspectable payload or Software Learning Report.
- Update the plan or next brainstorm to put hook proof before review-value expansion.
- Preserve existing staged work and implementation-pilot evidence as useful, but not enough for this gate.

Next:

- Build the smallest repo-local Codex hook smoke that executes reliably.
- Prefer `Stop` because skill-feedback needs turn-close evidence.
- Capture hook stdin payload shape without raw transcript content.
- Record whether the successful hook path is CLI, app, interactive, or `exec`.
- After proof, continue review-value ideation from Decision 3.

V2 Ideas:

- Add a dedicated `skill-feedback codex-hook-smoke` command.
- Add a Codex hook fixture from the proven payload shape.
- Add a decision if `codex exec` and interactive/app Codex differ materially.

## Decision 5: Make pattern resolution ledger the primary review model

```yaml
id: skill-feedback-pilot-005
status: accepted
decided_at: "2026-06-12"
decision: "Make pattern resolution ledger the primary review model"
owner: "skills/skill-feedback"
source:
  - "skills/skill-feedback/CONTEXT.md"
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "/Users/nathanvale/code/monash-smst/docs/ideation/2026-06-12-skill-feedback-review-value-ideation.html"
  - "2026-06-12 Codex session: pattern-ledger grill"
```

Decision:

- Make `skill-feedback review` primarily a pattern resolution ledger.
- Treat evidence quality as an attribute on each pattern, not the top-level product model.
- Keep implementation gated behind Codex lifecycle-hook proof.

Rationale:

- Review should answer which recurring pattern needs a resolution path.
- Evidence quality still matters, but it supports trust inside the pattern.
- Pattern grouping compounds across reports better than chronological open-item lists.
- The product should stay action-oriented without treating report text as canonical instruction.

Consequences:

- Future review-value brainstorms use pattern resolution ledger as the product center.
- Pattern entries can carry evidence quality, owner paths, run count, verification burden, and next safe action.
- Evidence quality badges should prevent false confidence without becoming the main surface.
- No implementation starts until the Codex lifecycle-hook proof gate from Decision 4 is satisfied.

Next:

- Grill the first ledger shape decision.
- Decide which pattern key groups evidence first.
- Update future brainstorm docs to treat pattern ledger as the review-value spine.

V2 Ideas:

- Add typed resolution paths such as `FIX`, `DEFER`, `SCOPE-CALL`, and `TIGHTEN`.
- Add evidence-quality badges inside each pattern.
- Add pattern aging, first-seen, last-seen, and resolved-state lanes.

## Decision 6: Make failure class the primary pattern key

```yaml
id: skill-feedback-pilot-006
status: accepted
decided_at: "2026-06-12"
decision: "Make failure class the primary pattern key"
owner: "skills/skill-feedback"
source:
  - "skills/skill-feedback/CONTEXT.md"
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "/Users/nathanvale/code/monash-smst/docs/ideation/2026-06-12-skill-feedback-review-value-ideation.html"
  - "2026-06-12 Codex session: failure-class grill"
```

Decision:

- Make failure class the primary grouping key for the pattern resolution ledger.
- Start with exact-match grouping against a small predefined class set.
- Keep owner path, evidence quality, verification burden, and resolution path as attributes on the grouped pattern.
- Do not use heuristic matching for MVP pattern merges.

Rationale:

- Failure class is the strongest review signal for recurring problem shape.
- Owner path helps route work, but it should not hide the repeated class of failure.
- Resolution path helps triage, but it depends on understanding the problem class first.
- Exact-match grouping keeps false merges out of the first version.

Consequences:

- The next design step must define the initial failure-class taxonomy.
- Unknown or ambiguous reports must remain unmerged until a known class applies.
- Review output can stay trustworthy before smarter matching exists.
- The ledger may under-group early evidence, which is safer than false pattern confidence.

Next:

- Decide the initial failure-class set.
- Decide the unknown-class label and no-merge behavior.
- Decide whether class assignment comes from closeout tags, review derivation, or both.

V2 Ideas:

- Add heuristic matching only after exact-match behavior produces useful evidence.
- Add confidence markers for suggested class merges.
- Add a review command for proposing taxonomy additions.

## Decision 7: Use product-native failure classes and keep taxonomy gaps standalone

```yaml
id: skill-feedback-pilot-007
status: accepted
decided_at: "2026-06-12"
decision: "Use product-native failure classes and keep taxonomy gaps standalone"
owner: "skills/skill-feedback"
source:
  - "skills/skill-feedback/CONTEXT.md"
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "/Users/nathanvale/code/monash-smst/docs/ideation/2026-06-12-skill-feedback-review-value-ideation.html"
  - "2026-06-12 Decision Mode: taxonomy gap grill"
```

Decision:

- Use a product-native failure-class set for the pattern resolution ledger.
- Seed the set with `capture_gap`, `correlation_gap`, `evidence_gap`, `verification_tax`, `ownership_gap`, `guidance_gap`, `scope_mismatch`, `tool_failure`, `signal_noise`, and `taxonomy_gap`.
- Treat `taxonomy_gap` as a standalone item, not a mergeable pattern.
- Merge only known failure classes by exact class match.

Rationale:

- Product-native classes fit the ledger language better than current friction categories or open-reason labels.
- Friction categories and open reasons are input signals, not the durable pattern model.
- `taxonomy_gap` keeps unknown shapes visible as product discovery instead of hiding them in `other`.
- Standalone unknowns avoid shadow taxonomy and false pattern confidence.

Consequences:

- Future implementation maps existing signals into product-native classes before grouping.
- Unknown or ambiguous reports stay separate until a known class is assigned.
- Review may show more standalone items early, which is safer than false merges.
- Taxonomy changes need explicit review instead of heuristic accumulation.

Next:

- Decide where failure-class assignment happens.
- Decide how the review surface displays standalone taxonomy gaps.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add a command for proposing taxonomy additions from repeated standalone gaps.
- Add suggested-class confidence only after exact-match behavior proves useful.
- Add class aliases only with explicit migration evidence.

## Decision 8: Let review assign failure classes from evidence

```yaml
id: skill-feedback-pilot-008
status: accepted
decided_at: "2026-06-12"
decision: "Let review assign failure classes from evidence"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "/Users/nathanvale/code/monash-smst/docs/ideation/2026-06-12-skill-feedback-review-value-ideation.html"
  - "2026-06-12 Decision Mode: class assignment grill"
```

Decision:

- Let `skill-feedback review` assign failure classes from captured evidence.
- Keep closeout receipts lightweight and evidence-only.
- Do not require closeout writers to provide a failure class in MVP.
- Keep product-native failure-class taxonomy ownership in review.

Rationale:

- Review has the broadest context for mapping signals into patterns.
- Closeout should stay focused on receipts, not taxonomy authoring.
- Driver-authored class labels would add burden and create bad-label risk.
- This keeps the pattern ledger's vocabulary consistent while evidence capture remains simple.

Consequences:

- Future implementation maps closeout and capture signals into failure classes during review.
- Closeout receipt schema does not grow a required failure-class field for MVP.
- Existing friction categories and open reasons remain input signals, not class owners.
- Classification mistakes are review-model issues, not closeout-author defects.

Next:

- Decide the first mapping table from current evidence signals to failure classes.
- Decide how review displays standalone `taxonomy_gap` items.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add optional closeout class hints only after review-owned classification proves useful.
- Add class-assignment diagnostics to show which evidence triggered a class.
- Add a hybrid path where review can accept or reject closeout hints.

## Decision 9: Use deterministic field rules for failure-class assignment

```yaml
id: skill-feedback-pilot-009
status: accepted
decided_at: "2026-06-12"
decision: "Use deterministic field rules for failure-class assignment"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "/Users/nathanvale/code/monash-smst/docs/ideation/2026-06-12-skill-feedback-review-value-ideation.html"
  - "2026-06-12 Decision Mode: mapping rules grill"
```

Decision:

- Use deterministic structured-field rules for MVP failure-class assignment.
- Let review map structured evidence fields into product-native failure classes.
- Treat narrative notes and summaries as evidence, not class selectors.
- Send ambiguous structured evidence to standalone `taxonomy_gap`.

Rationale:

- Deterministic field rules are inspectable and testable.
- Narrative classification would add fuzzy behavior before the ledger has proof.
- The review surface can explain which structured signal caused a class.
- This keeps the first classifier boring enough to trust.

Consequences:

- Future implementation starts from fields such as correlation status, evidence gaps, verification burden, friction category, and observation kind.
- The exact mapping table remains a follow-up decision.
- Narrative content can help humans inspect a report, but does not decide class in MVP.
- Review-owned classifier bugs stay separate from closeout receipt quality.

Next:

- Decide the first deterministic mapping priority.
- Decide fallback precedence when multiple structured signals point at different classes.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add narrative-assisted suggestions after deterministic rules prove useful.
- Add classifier diagnostics that list matched fields.
- Add fixtures for mixed-signal reports before introducing richer matching.

## Decision 10: Seed the first five deterministic failure-class mappings

```yaml
id: skill-feedback-pilot-010
status: accepted
decided_at: "2026-06-12"
decision: "Seed the first five deterministic failure-class mappings"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: five-pack mapping grill"
```

Decision:

- Map unlinked-correlation spike evidence to `correlation_gap`.
- Map actionable evidence-gap evidence to `evidence_gap`.
- Map heavy verification burden and verification-tax friction to `verification_tax`.
- Map tool-failure friction or observations to `tool_failure`.
- Map scope-mismatch friction or observations to `scope_mismatch`.

Rationale:

- Each mapping follows an existing structured signal without narrative interpretation.
- The mappings cover the strongest current review open reasons and direct friction categories.
- These classes are inspectable enough for MVP tests and help output.
- Deferring weaker mappings keeps the first batch from smuggling in fuzzy ownership or guidance logic.

Consequences:

- Future implementation can test these five mappings with field-only fixtures.
- `ownership_gap`, `guidance_gap`, `signal_noise`, `capture_gap`, and `taxonomy_gap` need separate rules.
- The mapping table stays review-owned and closeout receipts remain unchanged.
- No implementation starts until Codex lifecycle-hook proof satisfies Decision 4.

Next:

- Decide the next five-pack for ownership, guidance, signal noise, capture gaps, and taxonomy fallback.
- Decide precedence for mixed-signal reports.
- Add mapping fixtures only after the hook gate is satisfied.

V2 Ideas:

- Add per-pattern diagnostics showing the matched mapping rule.
- Add mapping confidence only after deterministic rules produce useful review evidence.
- Add migration notes if a future taxonomy split changes any seeded mapping.

## Decision 11: Seed the remaining deterministic failure-class mappings

```yaml
id: skill-feedback-pilot-011
status: accepted
decided_at: "2026-06-12"
decision: "Seed the remaining deterministic failure-class mappings"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: remaining mapping Five-Pack"
```

Decision:

- Map ownership signals to `ownership_gap`.
- Map guidance and missing-context signals to `guidance_gap`.
- Map capture or runtime missingness that blocks usable evidence to `capture_gap`.
- Map low-value structured open signals to `signal_noise`.
- Map reports with no deterministic class match to standalone `taxonomy_gap`.

Rationale:

- The remaining mappings complete the first product-native classifier shape.
- Each mapping still starts from structured fields instead of narrative text.
- `taxonomy_gap` preserves unknown shapes without false merges.
- `signal_noise` gives review a named low-value lane without promoting noise into an action pattern.

Consequences:

- Future implementation can cover the full seeded taxonomy with field-only fixtures.
- Ownership, guidance, capture, signal-noise, and taxonomy fallback rules remain review-owned.
- Closeout receipts still do not carry failure-class labels.
- No implementation starts until Codex lifecycle-hook proof satisfies Decision 4.

Next:

- Decide precedence for mixed-signal reports.
- Decide whether multiple failure classes can appear on one report or only one primary class.
- Add mapping fixtures only after the hook gate is satisfied.

V2 Ideas:

- Split `guidance_gap` from `missing_context` only if review evidence shows they behave differently.
- Add a noise-suppression view after `signal_noise` appears repeatedly.
- Add taxonomy proposal workflow after repeated standalone `taxonomy_gap` items.

## Decision 12: Let the review contract own failure-class precedence

```yaml
id: skill-feedback-pilot-012
status: accepted
decided_at: "2026-06-12"
decision: "Let the review contract own failure-class precedence"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: precedence governor grill"
```

Decision:

- Use one primary failure class per report for MVP ledger grouping.
- Let the `skill-feedback review` contract own the exact failure-class precedence order.
- Keep the decision log responsible for product rationale, not executable ordering.
- Prove the order through code, help, and tests when implementation begins.

Rationale:

- One primary class keeps ledger counts clean.
- Precedence is deterministic behavior, so it belongs with the review contract.
- Decision prose can drift from implementation unless tests guard the order.
- Configurable precedence adds unnecessary surface before the ledger proves value.

Consequences:

- Future implementation defines the precedence order in review-owned code.
- Tests must prove mixed-signal reports pick the expected primary class.
- Help or review diagnostics should expose the effective order when useful.
- The next product decision can focus on the actual precedence ladder.

Next:

- Decide the first precedence order.
- Decide whether matched-but-losing classes appear only in diagnostics or stay hidden for MVP.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add secondary matched-class diagnostics after the primary ledger stays useful.
- Add config only if repeated product evidence shows repo-specific ordering is needed.
- Add a drift check that compares documented order with tests.

## Decision 13: Adopt trust-first failure-class precedence

```yaml
id: skill-feedback-pilot-013
status: accepted
decided_at: "2026-06-12"
decision: "Adopt trust-first failure-class precedence"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: trust-first precedence grill"
```

Decision:

- Adopt trust-first precedence for MVP failure-class selection.
- Use this order as the product ladder: `capture_gap`, `correlation_gap`, `evidence_gap`, `verification_tax`, `ownership_gap`, `guidance_gap`, `tool_failure`, `scope_mismatch`, `taxonomy_gap`, `signal_noise`.
- Keep the review contract as the executable owner of the exact order.
- Treat matched-but-losing classes as future diagnostics, not MVP ledger lanes.

Rationale:

- Broken evidence should outrank action routing because routing untrusted reports creates false confidence.
- Verification burden belongs before ownership and guidance because expensive trust still affects review value.
- `taxonomy_gap` should outrank `signal_noise` because unknown shape is more useful than known low-value noise.
- The ledger stays useful when its primary class answers what must be trusted before what can be routed.

Consequences:

- Future implementation starts from the trust-first order in review-owned code.
- Mixed-signal fixtures need to prove the highest trust-first match wins.
- Review output keeps one primary class per report for MVP.
- Secondary matched classes wait for diagnostic work.

Next:

- Decide whether losing matched classes stay hidden or appear as diagnostics after MVP.
- Decide the display shape for precedence diagnostics if they are included.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add a matched-rules diagnostic lane after primary-class grouping is stable.
- Add precedence drift checks if docs, help, and tests start duplicating the order.
- Revisit the ladder after real reports show action routing is being buried too often.

## Decision 14: Put losing class matches in diagnostics, not ledger counts

```yaml
id: skill-feedback-pilot-014
status: accepted
decided_at: "2026-06-12"
decision: "Put losing class matches in diagnostics, not ledger counts"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: matched-rule diagnostics Five-Pack"
```

Decision:

- Keep one primary ledger lane per report in MVP.
- Do not let losing class matches create extra pattern counts.
- Expose losing class matches only as diagnostics.
- Hide matched-class diagnostics from `--plain` MVP output.
- Include matched-class diagnostics in JSON MVP output, with the exact field name owned by the review contract.

Rationale:

- The ledger stays clean when only the primary class contributes to counts.
- Diagnostics preserve inspectability without bloating the morning-review surface.
- Human plain output should stay focused on what to open and why.
- JSON diagnostics give agents enough context to inspect mixed-signal reports.

Consequences:

- Future implementation must separate primary ledger grouping from matched-rule diagnostics.
- Plain review output can omit losing matches without losing the primary decision.
- JSON review output can carry matched-class evidence for agent inspection.
- The review contract owns exact diagnostic field names, help text, and test fixtures.

Next:

- Decide the diagnostic display shape for JSON output.
- Decide whether diagnostics include rule ids, source fields, or only losing classes.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add matched-rule diagnostics to plain output only if human review needs them.
- Add rule ids if field-only class names are not enough to debug precedence.
- Add an explicit drift check if diagnostic field names appear in docs and tests.

## Decision 15: Shape JSON matched-class diagnostics with structured fields only

```yaml
id: skill-feedback-pilot-015
status: accepted
decided_at: "2026-06-12"
decision: "Shape JSON matched-class diagnostics with structured fields only"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: JSON diagnostic shape Five-Pack"
```

Decision:

- Include losing matched class names in JSON diagnostics.
- Include the structured source fields that caused each losing class match.
- Include the precedence rank for each losing class match.
- Exclude narrative excerpts from matched-class diagnostics.
- Omit matched-class diagnostics when a report has no losing matches.

Rationale:

- Losing class names show what else matched without changing ledger counts.
- Source fields let agents inspect why a losing class matched.
- Precedence rank makes the winner explainable without re-deriving the ladder.
- Excluding narrative keeps diagnostics structured and avoids quote/noise creep.
- Omitting empty diagnostics keeps JSON compact.

Consequences:

- Future JSON output can explain mixed-signal classification without bloating `--plain`.
- The review contract owns exact field names, schemas, help text, and tests.
- Narrative report text remains evidence for humans, not diagnostic classifier payload.
- Mixed-signal fixtures need to prove diagnostic omission and inclusion behavior.

Next:

- Decide the rule-id question for diagnostics.
- Decide whether source fields use exact report paths or stable symbolic names.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add rule ids if source fields and class names are not enough to debug precedence.
- Add human-readable diagnostic summaries if JSON-only diagnostics prove too hard to inspect.
- Add a compact diagnostic view after real agent consumers use the JSON payload.

## Decision 16: Use stable symbolic source-field names for matched-class diagnostics

```yaml
id: skill-feedback-pilot-016
status: accepted
decided_at: "2026-06-12"
decision: "Use stable symbolic source-field names for matched-class diagnostics"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: diagnostic source-field Five-Pack"
```

Decision:

- Use stable symbolic source-field names for matched-class diagnostics.
- Do not use indexed JSON paths in diagnostics.
- Deduplicate repeated symbolic source names within one diagnostic.
- Let the review contract own the allowed symbol set.
- Keep raw evidence details behind report inspection, not inside diagnostics.

Rationale:

- Stable symbols survive report reordering, grouping, fixture changes, and compaction.
- Indexed paths are brittle and make diagnostics depend on array positions.
- Deduplication keeps diagnostic payloads compact.
- Review contract ownership keeps field vocabulary code/help/test-owned.
- Raw evidence belongs in report inspection to avoid narrative/noise creep.

Consequences:

- Future JSON diagnostics point to stable symbolic sources such as `friction.category`, `evidence_gaps[].code`, `observations[].kind`.
- Diagnostic source-field symbols are guidance to inspect, not evidence excerpts.
- The review contract must own exact allowed symbols and validation.
- Mixed-signal fixtures need to prove indexed paths are not emitted.

Next:

- Decide whether diagnostics need rule ids now.
- Decide whether source-field symbols are global or namespaced by report section.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.

V2 Ideas:

- Add exact report paths only in a debug-only mode if symbolic names prove insufficient.
- Add symbol descriptions in generated help if agents struggle to interpret them.
- Add source-field grouping in diagnostics if repeated classes create bulky output.

## Decision 17: Omit rule ids from matched-class diagnostics MVP

```yaml
id: skill-feedback-pilot-017
status: accepted
decided_at: "2026-06-12"
decision: "Omit rule ids from matched-class diagnostics MVP"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: rule-id diagnostics choice"
```

Decision:

- Do not include rule ids in matched-class diagnostics MVP.
- Use class, source fields, and precedence rank as the explainability payload.
- Keep rule ids out of `--plain`.
- Add rule ids only if fixtures or implementation debugging prove ambiguity.
- If rule ids are added later, use stable symbolic ids owned by the review contract.

Rationale:

- Avoid expanding schema, naming, and test surface before evidence proves rule ids pay rent.
- Existing fields explain which class lost, why it matched, and where it sits in the precedence ladder.
- Source fields point to inspectable report data without narrative creep.
- Rule-id vocabulary can wait until real ambiguity appears.

Consequences:

- JSON diagnostics MVP stays compact.
- Mixed-signal fixtures should prove class, source fields, and precedence rank explain matched-class loss without rule ids.
- The review contract can add rule ids later as a V2 diagnostic field.
- `--plain` does not mention rule ids.

Next:

- Decide whether source-field symbols are global or namespaced by report section.
- Keep implementation blocked by Codex lifecycle-hook proof from Decision 4.
- Add rule-id ambiguity examples only if fixtures reveal them.

V2 Ideas:

- Add stable rule ids in JSON if class, source fields, and precedence rank are insufficient.
- Add rule-id help text if future agents need deeper traceability.
- Add debug-only diagnostics for rule-match internals.

## Decision 18: Use a global source-field symbol set for matched-class diagnostics MVP

```yaml
id: skill-feedback-pilot-018
status: accepted
decided_at: "2026-06-12"
decision: "Use a global source-field symbol set for matched-class diagnostics MVP"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: diagnostic source-field namespace choice"
```

Decision:

- Use one global allowed source-field symbol set for diagnostics MVP.
- Use fully qualified symbolic names such as `friction.category` and `evidence_gaps[].code`.
- Do not create per-section namespace owners in MVP.
- Let the review contract own the global symbol list and validation.
- Add section-scoped extensions only if name collision or readability pain appears.

Rationale:

- Global symbols keep diagnostics as one vocabulary.
- Fully qualified symbols already name the report section.
- Section-scoped ownership adds schema surface before the symbol set is large enough to need it.
- One symbol list is easier to test, document, and inspect.

Consequences:

- Diagnostic source fields stay under one contract surface.
- Fixtures should assert only allowed global symbols are emitted.
- Help can document one symbol list if diagnostics need discovery support.
- The review contract may add section-scoped extensions later if collisions appear.

Next:

- Decide the exact Codex lifecycle-hook proof gate before implementation resumes.
- Turn the decision trail into a brainstorm requirements doc after the hook-gate decision.

V2 Ideas:

- Split symbols into section namespaces if the list grows or collisions appear.
- Generate symbol registry documentation from the review contract if the set becomes hard to scan.
- Add debug mappings from symbols to report schema paths if agents need deeper traceability.

## Decision 19: Require Codex hook plus trusted skill identity before new feature work

```yaml
id: skill-feedback-pilot-019
status: accepted
decided_at: "2026-06-12"
decision: "Require Codex hook plus trusted skill identity before new feature work"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-12 Decision Mode: Codex hook proof gate"
  - "2026-06-12 user-provided degraded codex-hook-smoke report example"
```

Decision:

- Require Codex hook plus trusted skill identity proof before adding new exciting skill-feedback features.
- The proof gate is not just "hook fired".
- The proof gate passes only when a Codex lifecycle hook fires, writes an ignored `.skill-feedback/` report, includes trusted skill identity, and `review --plain` distinguishes hook capture from driver closeout.
- A degraded fallback-style record does not satisfy the proof gate when it uses a placeholder skill such as `codex-hook-smoke`, unknown skill version, empty model, zero usage, degraded state, or missing model/usage gaps.
- Do not describe the degraded fallback-style record as completed Codex lifecycle support.

Rationale:

- Hook-fire proof alone can show plumbing without proving useful skill attribution.
- Trusted skill identity is the minimum signal needed before report review can support real product decisions.
- Driver closeout evidence is already useful, but it is not a substitute for Codex lifecycle capture.
- Treating degraded fallback capture as success would restart feature work on weak evidence.

Consequences:

- New exciting skill-feedback features stay blocked until hook plus identity proof passes.
- Correlation between hook capture and driver closeout remains valuable but is not required to unblock the next implementation phase.
- Smoke evidence must show trusted skill identity, not a placeholder smoke skill.
- Review output must make hook capture and driver closeout visibly distinct.
- Requirements docs should name this as the readiness gate.

Next:

- Turn the accepted decision trail into a brainstorm requirements doc.
- Keep Codex hook plus identity proof as the first implementation gate.
- Defer hook-to-closeout correlation to a later requirement unless implementation uncovers a dependency.

V2 Ideas:

- Add hook-to-closeout correlation as the next maturity gate after identity proof.
- Add a lifecycle proof checklist command once the hook shape stabilizes.
- Add degraded-capture diagnostics that explain why fallback records do not count.

## Decision 20: Proceed with closeout-first anchor ledger

```yaml
id: skill-feedback-pilot-020
status: accepted
decided_at: "2026-06-13"
decision: "Proceed with closeout-first anchor ledger and remove taxonomy-first v2 scope"
owner: "skills/skill-feedback"
source:
  - "docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md"
  - "skills/skill-feedback/docs/plans/2026-06-12-002-feat-skill-feedback-pattern-ledger-v2-plan.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "2026-06-13 grill-with-docs: Codex pivot research"
  - "2026-06-13 user request: remove taxonomy-first scope"
supersedes:
  - skill-feedback-pilot-006
  - skill-feedback-pilot-007
  - skill-feedback-pilot-008
  - skill-feedback-pilot-009
  - skill-feedback-pilot-010
  - skill-feedback-pilot-011
  - skill-feedback-pilot-012
  - skill-feedback-pilot-013
  - skill-feedback-pilot-014
  - skill-feedback-pilot-015
  - skill-feedback-pilot-016
  - skill-feedback-pilot-017
  - skill-feedback-pilot-018
  - skill-feedback-pilot-019
```

Decision:

- Proceed with v2 closeout-first ledger work from `driver_declared` evidence while Trusted skill identity remains blocked.
- Group ledger entries by stable review anchors, not failure classes.
- Remove failure-class taxonomy, classifier, precedence, taxonomy-gap, and losing-class diagnostics from active v2 scope.
- Treat Codex Stop as Stop-detected turn/runtime evidence, not skill identity.
- Preserve Claude Code Stop-detected skill as runtime-specific evidence, still weaker than Trusted skill identity.
- Keep daily pilot and `trusted_engine_identity` gated until readiness conditions pass.
- Keep historical taxonomy decisions as superseded context instead of deleting them.

Rationale:

- Community signal supports hooks, OpenTelemetry, and evidence observability, but not a mature trusted skill-use lifecycle event for Codex.
- Driver closeouts already carry useful LLM evidence for review value.
- Evidence tiers fit current runtime support better than waiting for Trusted skill identity.
- Taxonomy-first scope adds product modeling before real ledger data proves categories pay rent.
- Anchor-based grouping preserves review value with less schema and less false confidence.

Consequences:

- Active v2 planning groups repeated evidence by stable anchors.
- Decisions 6 through 18 no longer drive the active v2 branch.
- Decision 19 is narrowed: daily pilot and Trusted skill identity stay gated, but closeout-first ledger implementation may proceed.
- Codex Stop evidence can improve runtime observability without satisfying Trusted skill identity.
- Future agents should not reintroduce failure-class contracts without a new accepted decision backed by ledger data.

Next:

- Implement the active v2 plan from the anchor-ledger requirements.
- Keep Trusted skill identity as a separate readiness claim.
- Mark earlier superseded entries in-place only if the log needs two-sided lifecycle metadata.

V2 Ideas:

- Reintroduce product-native categories only after real ledger data shows repeated anchors need higher-level grouping.
- Add a taxonomy proposal workflow later if anchor-ledger review becomes too granular.

## Decision 21: Make full claim-safe ReviewResultData the reducer contract

```yaml
id: skill-feedback-pilot-021
status: accepted
decided_at: "2026-06-13"
decision: "Make full claim-safe ReviewResultData the v2 reducer contract"
owner: "skills/skill-feedback"
source:
  - "skills/skill-feedback/prototypes/NOTES.md"
  - "skills/skill-feedback/prototypes/review-result-contract-contenders.logic.ts"
  - "skills/skill-feedback/docs/plans/2026-06-12-002-feat-skill-feedback-pattern-ledger-v2-plan.md"
  - "docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md"
  - "2026-06-13 prototype verdict: ReviewResultData contract contenders"
```

Decision:

- Make full claim-safe `ReviewResultData` v2 the reducer-owned Interface for active v2 work.
- Keep the anchor Adapter internal behind that Interface.
- Reject the minimal two-key reducer as the active implementation shape.
- Reject reducer plus anchor Adapter alone as the active implementation shape.
- Expose `review_unit_key`, `ledger_anchor_key`, `anchor_strength`, `weak_anchor_reason`, evidence tier, allowed claims, and split readiness from the review result.
- Derive `review_unit_key` from trusted `skill_run_id`; otherwise use report id.
- Derive `ledger_anchor_key` from canonical repo-contained path sets only.
- Keep weak anchors standalone and emit anchor-miss telemetry.
- Claim `corroborated` only when mixed evidence shares one trusted review unit.
- Preserve Codex Stop as runtime evidence, Claude Stop-detected skill as runtime-specific evidence, and `trusted_engine_identity` as engine-owned identity only.

Rationale:

- The prototype judged three reducer shapes against false merge, false corroboration, weak-anchor merge, and false readiness.
- Full claim-safe `ReviewResultData` scored highest with aggregate `52`.
- The minimal two-key reducer leaked false corroboration, weak-anchor merging, and Codex Stop false readiness.
- Reducer plus anchor Adapter prevented merge leaks but still left readiness and claim safety outside the Interface.
- Contract-owned allowed claims and split readiness keep safety at the reducer Seam instead of in renderer language.

Consequences:

- The replacement v2 plan starts from `ReviewResultData`, not a generic anchor-ledger implementation.
- The old v2 plan is superseded where it stops at anchor-ledger or adapter-only scope.
- Review JSON and plain output consume reducer-owned claims instead of recomputing claim language.
- Golden vectors need to prove same-anchor/no-trusted-run, weak-label-repeat, Codex Stop/no-identity, and Claude-linked-skill scenarios.
- The prototype can be deleted after the winning contract shape is absorbed.

Next:

- Write a replacement v2 plan around claim-safe `ReviewResultData`.
- Mark the old v2 plan as superseded by the replacement plan.
- Implement from the replacement plan when work resumes.

V2 Ideas:

- Reintroduce product-native categories only after ledger data proves category pressure.
- Use a future engine-owned skill lifecycle event as the clean `trusted_engine_identity` source when Codex exposes one.

## Decision 22: Lock ReviewResultData claim-safe grill rules

```yaml
id: skill-feedback-pilot-022
status: accepted
decided_at: "2026-06-13"
decision: "Lock ReviewResultData v2 claim-safe grill rules for reducer inputs, ledger output, readiness, corroboration, weak anchors, renderers, and field survival"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "2026-06-13 decision-mode grill: ReviewResultData v2"
decision_mode:
  question: "What claim-safe ReviewResultData v2 rules should implementation preserve?"
  option: "claim-safe rules accepted across grill rounds 1-9"
  confidence: strong
```

Decision:

- `ReviewResultData` carries facts plus allowed claims; renderers own wording and layout only.
- The reducer accepts normalized reports, review units, and anchor Adapter facts, not raw report mess.
- Ledger entries carry stable anchor facts, source review-unit facts, evidence tier, source mix, weak-anchor quarantine, allowed claims, resolution state, verification burden, and next safe action.
- Top-level `ReviewResultData` carries review units, ledger entries, anchor-miss telemetry, readiness by claim, allowed global claims, open actions, and no-action reason.
- Readiness is tracked by claim, not as one global boolean.
- Corroboration requires mixed Evidence source values inside the same trusted `review_unit_key`.
- Weak anchors stay standalone with weak-anchor reason, attempted target context, and anchor-miss telemetry.
- Renderers may format, filter, order, and choose wording; they may not infer readiness, corroboration, merge, trust, or new claim language.
- A v2 field survives only when it prevents false merge, false corroboration, weak-anchor merge, renderer overclaim, false readiness, or unsafe next action.

Rationale:

- Decision 21 picked full claim-safe `ReviewResultData` as the reducer contract.
- The grill clarified the exact safety rules needed to implement that contract without recreating unsafe renderer inference.
- Raw report parsing belongs upstream because the reducer should evaluate shaped evidence, not path and report-text weirdness.
- Allowed claims protect plain output, JSON, docs, and future agents from inventing stronger claims than the evidence supports.
- The field survival rule keeps v2 from becoming a dashboard bag of useful-looking fields.

Consequences:

- Implementation agents should treat these rules as the ReviewResultData v2 contract pressure, not optional renderer polish.
- Renderer code must consume allowed claims and readiness facts instead of recomputing claim language.
- Tests should prove the named false-claim failures directly: false merge, false corroboration, weak-anchor merge, renderer overclaim, false readiness, and unsafe next action.
- UX-only fields should stay out of `ReviewResultData` unless they block one of the named false claims or unsafe actions.

Next:

- Patch the replacement v2 plan with implementation-facing bullets from this decision before implementation resumes.
- Keep deterministic field names and exact schemas owned by code, tests, and command help once implementation starts.

V2 Ideas:

- Add a generated contract map if the ReviewResultData field set becomes hard for agents to scan.
- Add renderer lint tests if future output code starts inferring claim language again.

## Decision 23: Grill remaining ReviewResultData v2 branches in implementation order

```yaml
id: skill-feedback-pilot-023
status: accepted
decided_at: "2026-06-13"
decision: "Grill remaining ReviewResultData v2 branches in implementation order: plan capture, ICA vocabulary audit, golden vectors, field names, renderer migration, implementation order, and prototype absorption"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "2026-06-13 decision-mode grill: remaining ReviewResultData v2 branches"
```

Decision:

- Apply Decision 22 to the replacement v2 plan first.
- Run a narrow ICA vocabulary audit on the plan immediately after applying Decision 22.
- Grill golden test vectors after the plan uses the accepted contract language.
- Grill exact field names after golden vectors identify which facts need stable code-owned names.
- Grill renderer migration after field names and allowed-claim facts are clear.
- Grill implementation order after tests, fields, and renderer responsibilities are stable enough to sequence.
- Grill prototype absorption last, once normal tests name the prototype scenarios that must survive.

Rationale:

- Decision 22 is accepted truth, but implementation agents will work from the v2 plan.
- Applying the decision to the plan before more grilling prevents the next branches from drifting from the accepted contract.
- The ICA vocabulary audit should happen before golden vectors so test language uses `Seam`, `Interface`, `Adapter`, `Depth`, `Locality`, `Leverage`, and deletion-test terms precisely.
- Golden vectors should precede field names because tests expose which facts need stable names.
- Renderer migration should follow field naming because renderers need the reducer-owned allowed-claim facts before their inference is removed.
- Prototype deletion should be last because it depends on proof that prototype scenarios are represented in normal tests.

Consequences:

- Do not start with broad implementation sequencing.
- Do not do a full ICA architecture review before applying Decision 22 to the plan.
- Keep the ICA pass narrow: vocabulary and ownership audit only.
- Treat golden vectors as the next real grill after plan capture and vocabulary audit.
- Keep prototype files until their scenarios are absorbed into normal tests.

Next:

- Patch `skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md` with Decision 22.
- Audit the patched plan for ICA vocabulary and owner drift.
- Start the golden-vector grill from the patched, audited plan.

V2 Ideas:

- Add a generated implementation checklist if future agents lose the branch order.
- Add a plan-lint check only if repeated wording drift appears after the ICA vocabulary audit.

## Decision 24: Use seven golden vectors as the ReviewResultData v2 contract gate

```yaml
id: skill-feedback-pilot-024
status: accepted
decided_at: "2026-06-13"
decision: "Use six claim-safety golden vectors plus one v1 no-action preservation vector as the minimum ReviewResultData v2 contract proof"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "2026-06-13 decision-mode grill: golden vectors"
decision_mode:
  question: "Which golden-vector set is the minimum contract proof for ReviewResultData v2?"
  option: "six claim-safety vectors plus one no-action preservation vector"
  confidence: strong
```

Decision:

- Use seven golden vectors as the minimum pre-implementation contract gate.
- Prove same anchor without trusted run cannot claim `corroborated`.
- Prove repeated weak labels stay standalone.
- Prove Codex Stop-detected turn gives runtime evidence without Trusted skill identity or Daily pilot readiness.
- Prove Claude Stop-detected skill plus linked trusted review-unit evidence can claim `corroborated`.
- Prove JSON and plain renderers cannot infer stronger claims than reducer-owned allowed claims.
- Prove readiness advances per claim, not globally.
- Prove v1 coverage, open-item, and no-action triage survive when ledger data exists.

Rationale:

- The first six vectors prove the new `ReviewResultData` contract cannot lie about merge safety, corroboration, identity, renderer claims, or readiness.
- The seventh vector protects the v2 promise that ledger detail extends v1 review instead of replacing coverage and no-action behavior.
- A broader matrix is deferred until exact field names are stable because otherwise tests would lock premature implementation vocabulary.

Consequences:

- Golden-vector tests should land before implementation code relies on the v2 reducer shape.
- Field-name grilling should use these vectors to decide which facts need stable code-owned names.
- Renderer migration should treat the renderer-overclaim vector as a contract test, not just a UX test.
- Prototype deletion stays blocked until these vectors are represented in normal tests.

Next:

- Patch the replacement v2 plan so U4/U5/U6 name these seven vectors.
- Continue the grill with exact field names after the golden-vector gate is captured.

V2 Ideas:

- Expand into a matrix of Evidence source, Capture runtime, anchor strength, review-unit trust, and renderer output after field names are accepted.
- Add generated fixture documentation if golden vectors become hard to inspect in test code.

## Decision 25: Freeze only claim-safety field names before implementation

```yaml
id: skill-feedback-pilot-025
status: accepted
decided_at: "2026-06-13"
decision: "Freeze the ReviewResultData v2 field names that prevent false claims and leave display labels, helper names, and non-safety enum catalogues to implementation"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/prototypes/review-result-contract-contenders.logic.ts"
  - "2026-06-13 autonomous decision-mode batch: field names"
decision_mode:
  question: "Which names are stable enough for code-owned contract fields, and which stay conceptual until implementation?"
  option: "freeze claim-safety fields only"
  confidence: strong
```

Decision:

- Keep v1 fields `coverage`, `open_items`, `no_action`, `retention`, and `pilot_checkpoint`.
- Replace collapsed `capture_readiness` with `claim_readiness`.
- Add top-level `review_units`, `ledger_entries`, `anchor_miss_telemetry`, and `claim_readiness`; Decision 30 keeps allowed claims entry-local.
- Use `claim_readiness.runtime_capture`, `claim_readiness.trusted_skill_identity`, and `claim_readiness.daily_pilot`.
- Each readiness fact carries `status`, `reason_ids`, and `evidence_refs`.
- Use readiness statuses `ready`, `blocked`, and `evidence_only`.
- A review unit exposes `review_unit_key`, `report_ids`, `trusted_run`, and optional `trusted_skill_run_id`.
- A ledger entry exposes `ledger_entry_key`, `review_unit_keys`, `ledger_anchor_key`, `anchor_strength`, `weak_anchor_reason`, `attempted_targets`, `owner_paths`, `evidence_tier`, `source_mix`, `capture_runtime_mix`, `allowed_claims`, `resolution_state`, `verification_burden`, and `next_safe_action`.
- Use evidence tiers `driver_declared`, `runtime_observed`, `corroborated`, and `trusted_engine_identity`.
- Use allowed claims `repeated_anchor`, `mixed_evidence_sources`, `same_trusted_run`, `corroborated`, and `trusted_engine_identity`.
- Use anchor strengths `strong_path` and `weak`.
- Use weak-anchor reasons `label_only`, `missing_anchor`, `out_of_repo`, and `unverifiable`.
- Leave exact key serialization, `reason_ids` catalogue, `evidence_refs` shape, `resolution_state` values, renderer labels, section headings, and helper/module names to implementation tests and command-contract code.

Rationale:

- The stable fields are the fields needed by the seven golden vectors and Decision 22 false-claim guards.
- Freezing renderer copy or internal helper names now would add entropy without increasing claim safety.
- Keeping `claim_readiness` explicit prevents the current `capture_readiness` collapse from reappearing under a new name.

Consequences:

- U1 should update `command-contract.ts` around these field names before reducer work lands.
- Tests should fail unknown evidence-tier, allowed-claim, anchor-strength, weak-anchor-reason, and readiness-status values.
- Implementation may choose exact `reason_ids`, `evidence_refs`, and `resolution_state` catalogues only when tests need them.

Next:

- Patch the replacement v2 plan with the accepted field-name set.
- Use the field-name set to constrain renderer migration and implementation order.

V2 Ideas:

- Add generated field-map output if agents struggle to inspect the v2 contract.
- Add a reason-id catalogue only after readiness tests prove the minimum useful set.

## Decision 26: Migrate renderers as claim consumers only

```yaml
id: skill-feedback-pilot-026
status: accepted
decided_at: "2026-06-13"
decision: "Migrate JSON and plain review output to consume reducer-owned allowed claims and claim readiness without renderer-side claim inference"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-13 autonomous decision-mode batch: renderer migration"
decision_mode:
  question: "How do JSON and plain output stop inferring claims without losing useful review UX?"
  option: "render from allowed claims and claim readiness only"
  confidence: strong
```

Decision:

- JSON returns the `ReviewResultData` Interface fields directly inside the existing command envelope.
- Plain output preserves v1 coverage, low-signal, no-action, and open-item triage before ledger detail.
- Plain output renders human labels from `allowed_claims`, `evidence_tier`, and `claim_readiness`.
- Renderers may sort, filter, group, sanitize, and choose wording.
- Renderers may not derive `corroborated`, `trusted_engine_identity`, merge safety, Daily pilot readiness, or new allowed-claim language from source mix, runtime mix, shared anchors, or hook counts.
- Do not keep `capture_readiness` as a compatibility alias in v2 output.
- Redaction and section-spoofing defenses remain renderer responsibilities.

Rationale:

- The useful review UX is the v1 triage order plus readable ledger detail, not renderer-owned trust logic.
- A compatibility alias for `capture_readiness` would preserve the collapsed readiness shape that v2 is replacing.
- JSON and plain output stay easier to audit when they share the same reducer-owned claim budget.

Consequences:

- U6 renderer tests must include a negative same-anchor/no-trusted-run fixture for JSON and plain output.
- U6 renderer tests must prove Daily pilot readiness is not inferred from runtime capture readiness.
- Plain review copy can change, but every strong claim must be traceable to reducer-owned fields.

Next:

- Patch U6 with the no-alias renderer migration rule.
- Keep renderer migration after U1, U4, and U5 because it depends on field names, ledger claims, and readiness facts.

V2 Ideas:

- Add renderer-lint helpers if future output code starts branching on source mix or runtime mix for claim labels.

## Decision 27: Execute ReviewResultData v2 serially from contract to cleanup

```yaml
id: skill-feedback-pilot-027
status: accepted
decided_at: "2026-06-13"
decision: "Implement ReviewResultData v2 serially: contract, review-unit trust, anchor Adapter, reducer golden vectors, split readiness, renderers, then docs and prototype cleanup"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-13 autonomous decision-mode batch: implementation order"
decision_mode:
  question: "Which unit lands first after tests and plan language are stable?"
  option: "U1 contract first, then serial dependency order"
  confidence: strong
```

Decision:

- Start implementation with U1, the `ReviewResultData` v2 contract shape and contract tests.
- In U1, write the code-owned field/enumeration tests before runtime behavior depends on them.
- Run U2 after U1 to replace broad `skill_run_id` coalescing with trusted review-unit semantics.
- Run U3 after U1 to land the internal anchor Adapter and weak-anchor quarantine.
- Run U4 after U2 and U3 to implement the reducer and golden-vector ledger tests.
- Run U5 after U4 to replace collapsed readiness with `claim_readiness`.
- Run U6 after U5 to migrate JSON and plain renderers.
- Run U7 last to update docs and delete prototype scaffolding only after normal tests cover the vectors.
- Prefer serial execution for ce-work because U1-U6 share `command-contract.ts`, `skill-feedback-runner.ts`, and runner tests.

Rationale:

- The contract must exist before reducer, readiness, or renderer work can consume stable names.
- Review-unit trust and anchor facts are independent enough to follow U1, but both feed U4.
- Renderer migration cannot be safe until reducer-owned claims and claim readiness exist.
- Serial execution avoids shared-file conflicts in the current dirty worktree.

Consequences:

- ce-work should not parallelize U1-U6 in the same worktree.
- The first implementation verification target is command-contract coverage, not renderer output.
- Plan progress should not be tracked by editing checkboxes into the plan.

Next:

- Patch the replacement v2 plan with an explicit ce-work execution posture and serial unit order.
- Prepare a handoff that points ce-work at the replacement plan.

V2 Ideas:

- Split U2 and U3 into parallel worktrees only if future execution starts from a clean branch and worktree isolation is available.

## Decision 28: Absorb prototype scenarios into normal tests before deletion

```yaml
id: skill-feedback-pilot-028
status: accepted
decided_at: "2026-06-13"
decision: "Delete ReviewResultData v2 prototype files only after their winning scenarios and Decision 24 vectors live in normal tests"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/prototypes/NOTES.md"
  - "skills/skill-feedback/prototypes/review-result-contract-contenders.logic.ts"
  - "2026-06-13 autonomous decision-mode batch: prototype absorption"
decision_mode:
  question: "What prototype scenarios must move into normal tests before deleting prototype files?"
  option: "absorb all winning scenarios plus Decision 24 add-ons"
  confidence: strong
```

Decision:

- Absorb `same-anchor-no-trusted-run` into reducer tests.
- Absorb `weak-label-repeat` into anchor Adapter or reducer tests.
- Absorb `codex-stop-no-identity` into readiness tests.
- Absorb `claude-linked-skill` into review-unit and reducer tests.
- Add normal tests for renderer overclaim prevention, per-claim readiness advancement, and v1 triage preservation.
- Do not absorb prototype contender scoring, aggregate scoreboard, terminal UI, or weaker rejected-contender behavior.
- Delete `skills/skill-feedback/prototypes/`, its package script, and stale prototype references only after normal tests pass.

Rationale:

- The prototype proved the winning contract shape; permanent tests should preserve the behavior, not the exploratory scoring harness.
- Keeping rejected-contender mechanics would confuse implementation agents and overfit the production code to prototype internals.
- Deleting the prototype before absorption would lose the concrete edge cases that justified the wider Interface.

Consequences:

- U7 cleanup is blocked until U4, U5, and U6 tests cover the seven golden vectors.
- Handoff should tell ce-work to read prototype files as source evidence, not as implementation patterns to keep.
- Decision logs and plans may keep historical references to the prototype paths after deletion.

Next:

- Patch U7 with explicit prototype absorption and deletion conditions.
- Create a ce-work handoff naming the prototype files as read-before-delete evidence.

V2 Ideas:

- Replace prototype notes with generated fixture documentation if future tests need a human-readable scenario index.

## Decision 29: Separate trusted run proof from Trusted skill identity

```yaml
id: skill-feedback-pilot-029
status: accepted
decided_at: "2026-06-13"
decision: "Separate trusted run proof from Trusted skill identity for ReviewResultData v2"
owner: "skills/skill-feedback"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "skills/skill-feedback/src/command-contract.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "2026-06-13 decision-mode grill: trusted run predicate"
decision_mode:
  question: "Should trusted_run be an intermediate proof of same-run correlation, or only exist after full Trusted skill identity exists?"
  option: "trusted_run is separate same-run proof"
  confidence: strong
```

Decision:

- Treat `trusted_run` as runtime-owned or correlation-owned proof that reports belong to the same skill run.
- Keep `trusted_run` separate from Trusted skill identity and `trusted_engine_identity`.
- Treat raw, report-authored, missing, untrusted, or placeholder `skill_run_id` values as non-mergeable evidence.
- Allow trusted run proof to support `same_trusted_run` and `corroborated`.
- Do not allow trusted run proof alone to satisfy `trusted_engine_identity` or Daily pilot readiness.

Rationale:

- Current review coalesces reports by raw `skill_run_id`, which recreates the false-merge risk v2 exists to remove.
- The code already carries identity provenance separately from the raw id, so same-run proof can be modeled without overclaiming engine identity.
- Decision 24 needs the Claude-linked corroboration vector to remain possible, but Decision 20 keeps Trusted skill identity gated.
- The split lets implementation preserve useful correlation while keeping identity claims conservative.

Consequences:

- U2 must add a trust/provenance input before grouping reports by `skill_run_id`.
- Review-unit construction keys only on trusted provenance, not raw id presence.
- Spoofed `trusted_run` or `trusted_skill_run_id` values in input reports must be ignored or downgraded to report-local units.
- U4 and U5 tests must prove `same_trusted_run` and `corroborated` do not imply `trusted_engine_identity`.

Next:

- Patch the active v2 plan and glossary with the trusted-run boundary.
- Continue the grill with top-level `allowed_claims` scope.

V2 Ideas:

- Replace trusted-run fixtures with engine-owned skill lifecycle evidence if Codex exposes a native source later.

## Decision 30: Keep allowed claims entry-local

```yaml
id: skill-feedback-pilot-030
status: accepted
decided_at: "2026-06-13"
decision: "Remove top-level allowed_claims from ReviewResultData v2 and keep allowed claims entry-local"
owner: "skills/skill-feedback"
scope: "ReviewResultData top-level allowed_claims"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "2026-06-13 decision-mode grill: top-level allowed_claims scope"
decision_mode:
  question: "Should top-level allowed_claims exist in ReviewResultData v2?"
  option: "remove top-level allowed_claims and keep claims on entries only"
  confidence: strong
```

Decision:

- Remove top-level `allowed_claims` from the active v2 `ReviewResultData` shape.
- Keep `allowed_claims` entry-local on ledger entries.
- Require renderers and future agents to read claims from the ledger entry whose evidence supports the claim.
- Add summary-level claim fields later only with distinct field names and result-level semantics.

Rationale:

- A global claim set can be read as safe for the whole review result even when only one entry supports the claim.
- Entry-local claims keep every repeatable claim next to its evidence and anchor facts.
- Decision 22's field survival rule keeps v2 fields only when they prevent false claims or unsafe actions; global `allowed_claims` adds scope machinery without current proof.
- Removing the top-level field preserves renderer safety without weakening the ledger-entry contract.

Consequences:

- Decision 22 and Decision 25 are narrowed for the top-level `allowed_claims` field only.
- U1 contract tests should assert no global `allowed_claims` field exists in v2 review output.
- U4 and U6 tests should assert allowed claims are emitted and consumed from ledger entries.
- Future summary claims require a separate accepted decision and a field name that cannot be confused with entry-local claims.

Next:

- Patch the active v2 plan and glossary so allowed claims are entry-local.
- Continue the batch with Daily pilot readiness semantics, weak-anchor key presence, and review schema versioning.

V2 Ideas:

- Add `summary_claims` only if future agent consumers need result-level claim language backed by distinct predicates.

## Decision 31: Defer timestamp proximity to future candidate correlation

```yaml
id: skill-feedback-pilot-031
status: accepted
decided_at: "2026-06-13"
decision: "Defer timestamp-based driver-closeout to Stop-detected-turn correlation to a future inspect-only candidate-correlation lane"
owner: "skills/skill-feedback"
scope: "timestamp proximity correlation"
source:
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "2026-06-13 decision-mode grill: timestamp proximity evidence"
decision_mode:
  question: "Should timestamp-based candidate correlation be recorded as a future-version decision, excluded from current v2?"
  option: "record future-version deferral"
  confidence: strong
```

Decision:

- Treat timestamp proximity between driver closeout receipts and Stop-detected turns as future inspect-only candidate correlation.
- Do not include timestamp-proximity correlation in the current v2 implementation scope.
- Do not use timestamp proximity to derive `review_unit_key`, `ledger_anchor_key`, `same_trusted_run`, `corroborated`, `trusted_engine_identity`, Trusted skill identity readiness, or Daily pilot readiness.
- Allow a future version to add a candidate-correlation lane such as `candidate_correlations[]` only with explicit inspect-only semantics.
- Keep timestamps as supporting evidence, not identity proof.

Rationale:

- Timestamp proximity can reduce review noise by putting nearby closeout and Stop evidence in front of a human or future agent.
- Clocks, delayed closeouts, multiple skills in one turn, and batched agent work make timestamps too weak for same-run proof.
- Current v2 already protects claim safety by requiring trusted same-run proof before `same_trusted_run` or `corroborated`.
- Recording the exclusion now prevents future implementation agents from using "nearby in time" as accidental trust glue.

Consequences:

- U1-U6 should not add timestamp-based candidate-correlation fields for v2.
- U2 review-unit construction remains based on trusted run proof, not temporal proximity.
- U4 and U6 tests should keep timestamp proximity out of corroboration and renderer claim derivation.
- A future candidate-correlation feature needs its own field names, allowed language, and tests proving inspect-only behavior.

Next:

- Patch the active v2 plan Deferred and Outside This Version sections with the timestamp-proximity exclusion.
- Continue current v2 implementation planning without broadening scope.

V2 Ideas:

- Add `candidate_correlations[]` with `kind: temporal_proximity`, evidence references, time delta, and inspect-only wording after v2 ships.

## Decision 32: Apply remaining ReviewResultData v2 plan-review guardrails

```yaml
id: skill-feedback-pilot-032
status: accepted
decided_at: "2026-06-13"
decision: "Apply remaining ReviewResultData v2 plan-review guardrails before ce-work"
owner: "skills/skill-feedback"
scope: "ReviewResultData v2 implementation guardrails"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md"
  - "docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md"
  - "2026-06-13 ce-doc-review: ReviewResultData v2 plan"
  - "2026-06-13 decision-mode batch: remaining plan-review fixes"
decision_mode:
  question: "Accept the remaining five plan-review fixes before ce-work?"
  option: "accept all five"
  confidence: strong
```

Decision:

- Track readiness as separate facts, not independent gates.
- Make Daily pilot readiness depend on the accepted pilot gate, machine-observable approval, and Trusted skill identity evidence.
- Expose `ledger_anchor_key` only for strong-path ledger entries.
- Add a review-specific v2 schema/version path before removing `capture_readiness`.
- Add redaction coverage for every new v2 agent-authored string path rendered through JSON or plain output.
- Treat the active v2 plan and decision log as read-only U7 sources unless a separate accepted decision requires an append-only update.

Rationale:

- The doc review found these as concrete implementation guardrails, not product-scope relitigation.
- Daily pilot readiness can falsely appear ready if separate readiness facts are described as independent gates.
- Weak anchors must not gain mergeable keys through a universal ledger-entry field list.
- Removing `capture_readiness` without a v2 review schema/version path would create a silent breaking change.
- New v2 rendered strings expand the redaction surface beyond section-spoofing.
- U7 should update durable source docs without turning the active plan or decision trail into execution-state artifacts.

Consequences:

- U1 tests must prove review-specific v2 schema/versioning and strong-only `ledger_anchor_key` shape.
- U3 tests must prove weak anchors carry no mergeable `ledger_anchor_key`.
- U5 tests must prove runtime capture can become ready while Daily pilot stays blocked until all dependencies are present.
- U6 tests must prove redaction covers new v2 string paths before JSON and plain rendering.
- U7 files should exclude the active plan and decision log from normal edit scope.

Next:

- Patch the active v2 plan with the five guardrails.
- Re-run document checks before continuing to `ce-work`.

V2 Ideas:

- Add a generated v2 review contract map if schema/version and field-shape checks become hard to scan.

## Decision 33: Use DAG Build Validator Pattern For Merge Readiness

```yaml
id: skill-feedback-pilot-033
status: accepted
decided_at: "2026-06-13"
decision: "Use the DAG build validator pattern for skill-feedback review merge readiness"
owner: "skills/skill-feedback"
scope: "review merge-readiness execution"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "2026-06-13 Codex session: requested DAG build validator pattern"
```

Decision:

- Execute the merge-readiness plan as a dependency graph of implementation units.
- Treat tests and command-surface proofs as validators for each node before downstream nodes are considered complete.
- Keep the validator pattern as execution evidence, not as a new runtime abstraction.

Rationale:

- The plan has explicit dependencies across trusted-boundary, low-signal, purge, renderer, and cross-lane proof work.
- Validator-style checks prevent downstream review output from masking upstream trust-boundary gaps.
- The current code already has enough reducer and facade structure; a new pattern module would add ceremony without a second adapter.

Consequences:

- Implement U1 before U2 and U3, then use U4-U6 validators before U7 cross-lane proof.
- Prefer focused failing tests at each node, then implementation, then focused verification.
- Do not add a DAG runtime or pattern-named directory for this merge-readiness work.

Next:

- Run the U1 trusted-boundary validator tests first.
- Continue through dependent units only after the current node has focused passing checks.

V2 Ideas:

- Add machine-readable plan DAG validation only if future merge-readiness plans repeatedly drift from their dependency graph.

## Decision 34: Keep Low-Signal Codex Stop Evidence In Inbox Health

```yaml
id: skill-feedback-pilot-034
status: accepted
decided_at: "2026-06-13"
decision: "Keep unknown-skill Codex Stop evidence in inbox health instead of the primary review ledger"
owner: "skills/skill-feedback"
scope: "low-signal capture lane"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "skills/skill-feedback/src/command-contract.ts"
```

Decision:

- Route new unknown-skill Codex Stop capture to `.skill-feedback/low-signal/`.
- Classify legacy top-level unknown-skill Codex Stop reports as low-signal during review.
- Expose low-signal volume through `inbox_health`.
- Keep low-signal reports out of primary review units and ledger entries.

Rationale:

- Unknown-skill Codex Stop reports prove hook activity, not skill evidence.
- Review still needs hook-health visibility so capture problems are inspectable.
- A dedicated health surface prevents placeholder reports from flooding primary ledger claims.

Consequences:

- `coverage.total_reports` counts primary review reports, not low-signal capture volume.
- `claim_readiness.runtime_capture` may use low-signal capture evidence as evidence-only.
- Agents inspect `inbox_health.low_signal_count` before treating a quiet ledger as no hook activity.

Next:

- Add purge preview and execute support for both primary and low-signal lanes.
- Extend inbox health with invalid and unsafe artifact counts.

V2 Ideas:

- Add low-signal reason counts if multiple low-signal capture classes appear.

## Decision 35: Keep Review Read-Only And Put Deletion Behind Purge

```yaml
id: skill-feedback-pilot-035
status: accepted
decided_at: "2026-06-13"
decision: "Keep review read-only and put inbox deletion behind explicit purge"
owner: "skills/skill-feedback"
scope: "inbox lifecycle and purge command"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "skills/skill-feedback/src/command-contract.ts"
```

Decision:

- Keep `skill-feedback review` mutation-free.
- Let review observe invalid, unsafe, primary, and low-signal inbox artifacts through `inbox_health`.
- Make `skill-feedback purge` the only inbox deletion owner.
- Default purge to preview mode.
- Require exactly one retention selector before preview or execute.
- Require `--execute` before deletion.
- Recheck each selected candidate as a regular file inside `.skill-feedback/` immediately before deletion.

Rationale:

- Review should remain a validator, not a cleanup tool.
- Unsafe and invalid artifacts should not block valid evidence review.
- Deletion needs a distinct write contract with preview and execute semantics.
- A pre-delete recheck closes symlink and path-race gaps that scanner-time validation cannot prove.

Consequences:

- Agents can inspect inbox health without mutating evidence.
- Purge command metadata, help, parser, and runtime tests must move together.
- Low-signal reports are purgeable without entering primary ledger claims.
- Invalid artifacts remain for human or future repair unless purge grows a separate invalid-artifact policy.

Next:

- Continue to U5 renderer and action stability.
- Keep purge docs in U7 thin and point to command help or contract tests for exact flags.

V2 Ideas:

- Add per-lane retention defaults only after real inbox volume shows a stable threshold.

## Decision 36: Use Stable Evidence Refs For Review Actions

```yaml
id: skill-feedback-pilot-036
status: accepted
decided_at: "2026-06-13"
decision: "Use stable evidence refs for review actions and keep renderer claims reducer-owned"
owner: "skills/skill-feedback"
scope: "review action identity and plain rendering"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "skills/skill-feedback/src/review-ledger-reducer.ts"
  - "skills/skill-feedback/src/command-contract.ts"
```

Decision:

- Require `open_items.evidence_refs`.
- Derive `open_actions.action_key` from reason, stable refs, and target, not array index.
- Keep `open_actions.evidence_refs` as stable refs instead of prose evidence.
- Derive ledger `resolution_state` from anchor/actionability at projection time.
- Show capture runtime mix in plain ledger output.
- Sanitize every untrusted string rendered into plain review output.

Rationale:

- Index-based action keys drift when inbox file order changes.
- Prose evidence is useful for humans but unsafe as an agent address.
- Weak or label-only ledger entries can be evidence without being open work.
- Plain renderers should repeat reducer-owned facts, not recreate claims.

Consequences:

- Agents can store and compare action keys across equivalent inbox orderings.
- Weak ledger entries default to `no_action`.
- Plain output exposes hook runtime context without implying corroboration.
- Renderer tests cover control-character spoofing for action evidence and target labels.

Next:

- Continue to U6 failure containment for writes and subprocesses.

V2 Ideas:

- Add dedicated `review_unit:` or `ledger:` refs once downstream consumers need finer-grained action routing.

## Decision 37: Contain Writes And Subprocesses Before Review Merge

```yaml
id: skill-feedback-pilot-037
status: accepted
decided_at: "2026-06-13"
decision: "Contain skill-feedback writes and subprocesses before review merge"
owner: "skills/skill-feedback"
scope: "write safety and subprocess timeout behavior"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "hooks/skill-feedback-runtime.ts"
```

Decision:

- Write inbox reports through a temp-plus-link helper instead of writing final JSON paths directly.
- Roll back any final-path partial after record or closeout report write failure.
- Return facade error envelopes for record and closeout write failures.
- Count interrupted `*.json.tmp-*` files as invalid inbox health during review.
- Bound runner subprocesses with the same timeout convention used by hooks.
- Let git SHA timeout degrade telemetry, while gitignore timeout blocks writes fail-closed.

Rationale:

- Final-path partial JSON can poison review and confuse later purge decisions.
- Write failures should tell agents whether state changed.
- Temp artifacts are useful health evidence but not valid reports.
- Hung git subprocesses should not trap hooks or agents.

Consequences:

- Successful writes keep restrictive permissions and no-overwrite semantics.
- Review remains available when temp artifacts exist.
- Timeout exit code `124` is the shared bounded-subprocess signal.
- Hook and runner tests must both cover timeout behavior.

Next:

- Continue to U7 cross-lane proof and reference updates.

V2 Ideas:

- Add fsync and permission-preservation hardening if inbox writes become shared across platforms.

## Decision 38: Prove Cross-Lane Review With Conservative Claims

```yaml
id: skill-feedback-pilot-038
status: accepted
decided_at: "2026-06-13"
decision: "Prove cross-lane review with conservative claims before merge"
owner: "skills/skill-feedback"
scope: "cross-lane review validation and references"
source:
  - "skills/skill-feedback/docs/plans/2026-06-13-003-fix-skill-feedback-review-merge-readiness-plan.md"
  - "skills/skill-feedback/src/skill-feedback.test.ts"
  - "skills/skill-feedback/src/command-contract.test.ts"
  - "skills/skill-feedback/SKILL.md"
  - "skills/skill-feedback/references/report-shape.md"
```

Decision:

- Prove unknown-skill Codex Stop capture stays in low-signal health beside closeout evidence.
- Prove named Claude Stop capture stays in the primary lane.
- Prove primary hook capture plus closeout can show `repeated_anchor` and `mixed_evidence_sources`.
- Keep live cross-lane review below `corroborated` until writer-owned trusted-run proof exists.
- Keep purge and review references thin; command flags and exact semantics stay in help, contract tests, and runner tests.

Rationale:

- Low-signal capture is hook-health evidence, not skill evidence.
- Named hook capture is valid primary evidence but still untrusted without writer-owned correlation.
- Mixed-source evidence helps agents inspect a path without promoting it to a trusted claim.
- Durable docs should route agents to owners, not copy CLI contracts that can drift.

Consequences:

- Review merge readiness is proved by real-runner cross-lane tests plus reducer vectors.
- `inbox_health` remains the observable surface for low-signal volume.
- `corroborated` remains a synthetic or future writer-owned-correlation claim, not a raw inbox claim.
- Docs can stay shorter because command discovery, help, parser tests, and runtime tests own deterministic behavior.

Next:

- Run final gates across skill-feedback scripts, hook tests, typecheck, and Biome.
- Use fallow and skill-feedback closeout after verification.

V2 Ideas:

- Add a writer-owned correlation source and promote only those runs to live `corroborated` claims.

## Decision 39: Bump Review Result Schema For Required Agent Fields

```yaml
id: skill-feedback-pilot-039
status: accepted
decided_at: "2026-06-14"
decision: "Bump skill-feedback review result schema to 3 for required inbox health and evidence refs"
owner: "skills/skill-feedback"
scope: "ReviewResultData result contract"
source:
  - "skills/skill-feedback/src/command-contract.ts"
  - "docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md"
  - "2026-06-14 decision-mode: review schema version"
decision_mode:
  question: "Should skill-feedback review bump its result schema from 2 to 3 for the new required review fields?"
  option: "1"
  confidence: strong
```

Decision:

- Bump `SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION` from `"2"` to `"3"`.
- Treat required `inbox_health` and `evidence_refs` as a review result contract change.
- Keep persisted Software Learning Report records on schema `"1"`.

Rationale:

- `inbox_health` and `evidence_refs` are required agent-facing review fields.
- Older readers should not silently accept changed review output assumptions.
- The review surface is facade-backed and machine-consumed even before Daily pilot launch.
- A schema bump is clearer than documenting an intra-pilot exception to contract hygiene.

Consequences:

- Review JSON, review error envelopes, discovery metadata, and parser tests use schema `"3"`.
- Agents can branch on review result schema instead of guessing field availability.
- Future required review result fields should repeat this explicit schema-version check.

Next:

- Run focused review contract and runner tests.
- Continue resolving remaining review-open questions without deleting review artifacts.

V2 Ideas:

- Add generated review contract maps if future schema upgrades become hard to audit manually.

## Decision 40: Document Report Ref Lookup Before Adding A Resolver Command

```yaml
id: skill-feedback-pilot-040
status: accepted
decided_at: "2026-06-14"
decision: "Document report ref lookup now and defer a show or resolve-ref command"
owner: "skills/skill-feedback"
scope: "agent-facing review evidence refs"
source:
  - "skills/skill-feedback/SKILL.md"
  - "skills/skill-feedback/references/report-shape.md"
  - "docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md"
  - "2026-06-14 decision-mode: report ref resolution"
decision_mode:
  question: "Should report refs get a resolver command before merge?"
  option: "1"
  confidence: strong
```

Decision:

- Document the lookup path for `report:<id>` refs before merge.
- Resolve `report:<id>` through JSON review output and `review_units[*].report_ids`.
- Scan safe `.skill-feedback/**/*.json` reports by `report_id` only when raw report content is needed.
- Do not add `show report:<id>` or `resolve-ref` before merge.

Rationale:

- `report:<id>` is stable agent-addressable evidence, but filenames are timestamp/skill/hash artifacts.
- Documentation closes the immediate agent-native gap without adding a new command surface.
- A new command would need discovery metadata, help, parser, runtime semantics, and tests.
- Real downstream usage can justify a resolver command later with better evidence.

Consequences:

- Agents should not infer filenames from `report:<id>`.
- Review docs remain the audit trail; this decision updates routing guidance only.
- Future resolver work is additive and should use `cli-author` before adding the command.

Next:

- Keep `show` or `resolve-ref` as deferred follow-up work.
- Continue resolving remaining review-open questions.

V2 Ideas:

- Add `show report:<id>` if agents repeatedly need raw report inspection from review refs.

## Decision 41: Defer Temp Artifact GC Until A Separate Contract Decision

```yaml
id: skill-feedback-pilot-041
status: accepted
decided_at: "2026-06-14"
decision: "Defer orphaned temp artifact GC and treat temp files as invalid inbox health"
owner: "skills/skill-feedback"
scope: "inbox temp artifact lifecycle"
source:
  - "skills/skill-feedback/references/report-shape.md"
  - "docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md"
  - "2026-06-14 decision-mode: temp artifact GC"
decision_mode:
  question: "What should we do with orphaned .tmp-* files before merge?"
  option: "1"
  confidence: strong
```

Decision:

- Defer temp-artifact deletion before merge.
- Treat interrupted `.json.tmp-*` artifacts as invalid inbox health.
- Do not include temp artifact cleanup in `purge --execute` without a separate result-contract decision.

Rationale:

- Review already exposes temp artifacts as invalid inbox health.
- Deleting temp artifacts changes mutation semantics.
- Adding temp deletion to `deleted_paths` would mix report deletion with writer-cleanup artifacts.
- A separate temp-GC result field or command can be designed later if live inbox data proves the need.

Consequences:

- Merge readiness does not depend on temp artifact cleanup.
- Agents inspect inbox health rather than assuming purge clears all invalid artifacts.
- Future temp-GC work needs an explicit contract owner and tests.

Next:

- Keep temp GC as follow-up work.
- Continue resolving remaining review-open questions.

V2 Ideas:

- Add `deleted_temp_paths` or a temp-cleanup mode if temp artifacts accumulate in real inboxes.

## Decision 42: Derive Low-Signal Reason Ids Per Report

```yaml
id: skill-feedback-pilot-042
status: accepted
decided_at: "2026-06-14"
decision: "Derive low-signal reason ids per report from current classifier branches"
owner: "skills/skill-feedback"
scope: "review inbox health low-signal reasons"
source:
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "skills/skill-feedback/src/skill-feedback.test.ts"
  - "skills/skill-feedback/references/report-shape.md"
  - "docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md"
  - "2026-06-14 decision-mode: low-signal reason ids"
decision_mode:
  question: "Should low-signal reason ids be derived per report before merge?"
  option: "2"
  confidence: accepted_after_challenge
```

Decision:

- Derive `inbox_health.low_signal_reason_ids` from each low-signal report.
- Emit `unknown_skill_codex_stop` for unknown-skill Codex Stop reports.
- Emit `low_signal_lane_report` for reports treated as low-signal only because they live in `.skill-feedback/low-signal/`.
- Keep the existing review schema because the field already accepts a string array.
- Avoid a broader reason taxonomy until another producer exists.

Rationale:

- The array shape should carry real per-report signal, not a hardcoded singleton.
- Current implementation has two classification branches: content-classified unknown-skill Codex Stop and explicit low-signal lane placement.
- Narrow derivation closes the review P3 without inventing stable categories beyond code-owned branches.

Consequences:

- Mixed low-signal inboxes expose all observed reason ids deterministically.
- Agents can distinguish classifier-owned unknown-skill capture from explicit low-signal lane artifacts.
- Future low-signal producers should add a classifier branch, test, and report-shape line.

Next:

- Run focused review lane tests, full skill-feedback tests, and typecheck.
- Continue resolving the remaining subprocess timeout cleanup question.

V2 Ideas:

- Add a contract-owned low-signal reason enum only after multiple producers need a public catalog.

## Decision 43: Keep Hook And Runner Timeout Constants Local

```yaml
id: skill-feedback-pilot-043
status: accepted
decided_at: "2026-06-14"
decision: "Keep hook and runner subprocess timeout constants local until extraction is pressure-earned"
owner: "skills/skill-feedback"
scope: "bounded subprocess timeout ownership"
source:
  - "hooks/skill-feedback-runtime.ts"
  - "skills/skill-feedback/src/skill-feedback-runner.ts"
  - "docs/reviews/2026-06-13-003-skill-feedback-merge-readiness/INDEX.md"
  - "2026-06-14 decision-mode: subprocess timeout constants"
decision_mode:
  question: "Should subprocess timeout constants be shared before merge?"
  option: "1"
  confidence: strong
```

Decision:

- Keep `DEFAULT_HOOK_PROCESS_TIMEOUT_MS` in `hooks/skill-feedback-runtime.ts`.
- Keep `DEFAULT_RUNNER_PROCESS_TIMEOUT_MS` in `skills/skill-feedback/src/skill-feedback-runner.ts`.
- Treat the duplicated `6_000` value as intentional local ownership.
- Extract only if a third timeout owner appears or a drift bug proves shared ownership is needed.

Rationale:

- Hook runtime and skill-feedback runner have different ownership boundaries.
- Sharing one number would force `hooks/` to import skill package internals, the package to import hook code, or a new shared module for one value.
- Current tests prove the meaningful invariant: subprocesses are bounded and timeout exits report `124`.
- Two local constants with tests create less entropy than a shared abstraction without pressure.

Consequences:

- Merge readiness does not depend on timeout constant extraction.
- Future timeout changes must update both local owners deliberately.
- Review docs close the optional timeout-sharing item as accepted local duplication.

Next:

- Keep timeout behavior covered by hook and runner tests.
- Revisit extraction only after another owner or drift failure appears.

V2 Ideas:

- Add a shared subprocess helper only if more skill-feedback surfaces need identical process control.

## Decision 44: Support Claude Daily Pilot Now And Defer Codex Trusted Identity

```yaml
id: skill-feedback-pilot-044
status: accepted
decided_at: "2026-06-29"
decision: "Support Claude Code daily-pilot use now and defer Codex Trusted skill identity until Codex ships an engine-owned skill invocation source"
owner: "skills/skill-feedback"
scope: "runtime support boundary and pilot gate"
source:
  - "skills/skill-feedback/TASKS.md"
  - "skills/skill-feedback/CONTEXT.md"
  - "docs/research/2026-06-13-codex-stop-hooks-skill-observability-community-signal.md"
  - "docs/adr/0014-skill-feedback-fires-on-harness-hooks-not-agent-recall.md"
  - "2026-06-29 openai-docs Codex manual refresh"
  - "2026-06-29 skill-feedback health/correlate review"
decision_mode:
  question: "Should daily pilot stay blocked on Codex Trusted skill identity, or should Claude Code support proceed while Codex waits for engine-owned skill lifecycle support?"
  option: "Support Claude now; defer Codex Trusted skill identity"
  confidence: strong
```

Decision:

- Support Claude Code as the current daily-pilot runtime.
- Treat Claude Stop plus transcript-backed skill evidence as sufficient runtime support for the Claude path.
- Keep Codex Stop as runtime-observed evidence only.
- Defer Codex Trusted skill identity until Codex exposes an engine-owned skill invocation source.
- Do not block Claude daily-pilot use on Codex Trusted skill identity.

Rationale:

- Current research and the 2026-06-29 official Codex manual refresh show Codex supports hooks and skills, but not a public engine-owned skill lifecycle event.
- Claude already has the stronger live close-detection path in this repo.
- Correlation preview found no repairable path; waiting on correlation does not unlock Codex identity.
- Daily product value comes from review and closeout on supported runtime evidence, not from pretending Codex can prove more than it can.

Consequences:

- Decision 1's old "true Codex end-to-end proof before daily pilot" gate is superseded for Claude-supported daily use.
- Claude daily-pilot language can be positive while Codex readiness stays explicitly deferred.
- Codex health and review output must keep `trusted_skill_identity_missing` or equivalent blocked language until a real engine-owned source exists.
- Future Codex support work is a watchpoint, not an active blocker for Claude daily use.

Next:

- Align pilot and readiness wording across task, context, and report-shape docs.
- Keep watching Codex hook and skill lifecycle support for an engine-owned identity source.
- Re-open Codex Trusted skill identity only when Codex ships the missing feature.

V2 Ideas:

- Add a runtime-scoped pilot status surface so Claude-ready and Codex-deferred can render without wording drift.
