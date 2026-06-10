# Loop-Proof Method Catalog

Methods for proving a loop-engineering feature works before trusting it.

Use when adding or changing a loop feature: find the loop part you touched, run its method, earn the slot.

## Rules

- Organize by loop part, not by test type. Spine: what are you proving.
- Every method carries a trust condition. No trust condition = theater.
- Trust conditions: `oracle` (known answer), `independence` (blind replication), `adversarial` (incentivized to break), `falsifiability` (a defined way to fail).
- Growth gate: a method earns a slot only after it has proven or broken a real loop change. No speculative methods. Same earned-entry discipline as the gotcha pattern in `skills/create-skill/references/skill-design-decision-runbook.md`.
- Unearned slots name the part and its failure; mark the method `unearned`.
- Entry shape: claim proven -> method -> trust condition -> pass criterion -> worked example.

## Cross-Cutting Trust Conditions

Fold these into a part's method; do not give them their own slot.

- Routing folds into step function: a classifier is a step function whose output is a category. Test as a multi-class fixture.
- Cost/budget folds into stop rule: a max-pass cap is a halt reason beside converged and blocked. The halt must name its reason, or budget-exhaustion fakes convergence.
- Observability folds into state ledger: legibility is the quality bar on the ledger. A fresh agent must reconstruct the run from the ledger alone.
- Harness-vs-prompt is a precondition on every method: a property is provable only if harness-owned, not agent-self-asserted. The stop rule is untrustworthy if prompt-owned.

## Highest-Leverage Shape

- An LLM prose judge often has no per-output oracle.
- Metamorphic relations beat oracles there: assert the output relation under an input transform, not one correct answer.
- Example: idempotent convergence (MR-4) proves the stop rule without ground truth.

## Catalog

### Trigger / input — unearned

- Failure: over-triggers (burns budget) or under-triggers (silently never fires).
- Method: trigger corpus — labeled should-fire / should-not-fire inputs, incl. real near-misses and an under-trigger case; prove fire-rate matches labels.
- Trust: oracle.

### Step function — earned

- Claim: the detector fires on a real defect and rejects a clean input.
- Method: fixture pair — one planted positive (known contradiction), one near-miss negative (surface tension that resolves clean).
- Trust: oracle (known answer per fixture).
- Pass: positive accepted with correct shape + sources; negative rejected.
- Worked example: `fixtures/fixture-positive-safety` accepted 3/3; `fixtures/fixture-negative-near-miss` rejected 3/3.
- Scale-up (unearned): mutation kill-rate — N single-fault mutants, one per conflict shape, plus equivalent mutants; report kill-rate and false-kill-rate.

### Model-judgment — earned

- Claim: a prose verdict is stable across runs, not phrasing roulette.
- Method: blind-judge replication — N independent agents, same input, no shared context.
- Trust: independence.
- Pass: verdicts unanimous, or variance bounded and reported.
- Worked example: 6 blind agents over the two fixtures; 6/6 unanimous, 0 flips.
- Known limitation: the two fixtures leak their verdict in frontmatter `name`/`description` (`positive`/`near-miss`). The contradiction still carried the signal (6/6), but true blinding needs de-labeled twins. Do not rename the fixtures — the directory name derives the loop-file path.

### Stop rule — earned

- Failure: never halts, halts early, or fakes convergence at the budget ceiling.
- Method: idempotent convergence (MR-4) — re-audit a converged loop fresh; it must add zero new accepted findings.
- Trust: falsifiability (a fresh pass that adds a finding disproves the fixed point).
- Pass: fresh pass reproduces zero new accepted.
- Worked example: fresh blind pass on the converged self-audit reproduced zero new accepted.
- Companions (unearned): pre-registered predicate — fix the convergence predicate before the run, assert the halt matched it, not a cost cap. False-convergence injection — inject a known finding into a converged target; the loop must flip back to active.

### State ledger — earned

- Failure: state lies (frontmatter vs body), or state dies on resume.
- Method: resume-honesty replication — hand a converged loop file to a blind agent; it must continue from the file alone without re-discovering closed findings.
- Trust: independence + oracle (the known answer is "already converged with these closed signatures").
- Pass: blind resume is no-op or append-only; no closed signature re-opened; history never deleted.
- Worked example: blind agent resumed the `create-cli` loop file, re-derived all 3 closed signatures as non-contradictions, re-opened none, confirmed convergence.
- Companions (unearned): frontmatter-body consistency oracle (static invariants); golden-ledger drift (freeze the ledger; diff after a rule or model change).

### Idempotency / resume-safety — unearned

- Failure: re-entering a pass double-applies effects or corrupts state.
- Method: replay-twice equivalence — run pass N twice from the same input; assert identical ledger, incl. a partial/interrupted write.
- Trust: falsifiability.
- Distinct from state ledger: ledger proves content is correct; this proves re-entry is safe.

### Nesting / orchestration — N/A (single-level loop)

- Failure: outer loop bleeds state across inner invocations, or promotes a not-done inner as done.
- Method: isolation probe — two inner invocations sharing a poisonable key; prove the sibling sees clean state and the outer reads each stop signal.
- Trust: adversarial.
- Applies only once the loop has >=2 levels.

### Repair handoff — earned

- Failure: handoff is unactionable, loses evidence, names the wrong owner, or over-reaches into a source edit.
- Method: blind downstream actionability — hand the repair candidate to a blind repair agent; it must locate the conflict and propose a fix from the candidate alone.
- Trust: independence + oracle.
- Pass: blind agent locates both sources and proposes a valid fix without the audit narrative.
- Worked example: blind `create-skill` agent acted on RC-1, quoted both conflicting sources, proposed a valid fix, did not need the narrative.
- Companion (unearned): over-reach tripwire — watch the working tree during a run; assert only the audit file mutates, never source.

### Design decision — earned (out-of-loop)

- Claim: a design is sound before it is built.
- Method: adversarial premise attack — reviewers incentivized to break the design, not bless it.
- Trust: adversarial.
- Pass: the design survives, or is killed with reasons before build cost is spent.
- Worked example: 4 reviewers killed the proposed multi-skill sweep before implementation.

## Rationale Anchors

- `docs/research/loop-engineering-patterns/` — loop anatomy (bounded/unbounded, memory tiers, self-auditing, pipeline audit chain, nested hierarchy, harness-vs-prompt).
- `docs/ideation/` — the ideation pass that mapped loop part -> failure -> method and the rejected candidates.
- Research explains method shape only. A method earns its slot from a real local run, not from this anchor.
