# Meeting Playbook

Use after the retrospective target and existing evidence are resolved.

## Seven phases

1. **Keep:** What worked and deserves protection?
2. **Improve:** What caused rescue, delay, rework, cost, or uncertainty?
3. **Surprises:** What changed the participants' understanding?
4. **Lessons:** What would the participants do earlier or differently?
5. **Evidence:** Which conclusions are proven, reported, or still hypotheses?
6. **Experiments:** What small tests could reduce the biggest uncertainty?
7. **Commitments:** Which three actions earn owners and success measures?

Ask one question at a time. Follow answer-created branches before moving phases
when they affect the current conclusion. Put attractive but non-blocking ideas
in `Parking lot` and continue.

## Ten improvements learned from the CLI Command Facade retro

1. **Read in first.** Start from existing findings and owner docs so the meeting
   tests known decisions instead of reconstructing history from memory.
2. **Show position.** Keep the phase and remaining known branches visible so an
   interrupted participant can re-enter without holding the agenda in memory.
3. **Ask one thing.** Use one short, plain-language question. Explain technical
   terms before asking for a decision.
4. **Reflect once.** Convert the answer into a concise board item immediately.
   Do not repeat the same question after the meaning is clear.
5. **Triangulate experience.** Combine human reports with session patterns,
   skill feedback, and files or command receipts. Never treat agent self-report
   as proof of successful behavior.
6. **Allow green findings.** Do not scrape for failures when daily use is
   working. Record a positive finding and mark suspected weaknesses as evidence
   gaps.
7. **Turn ideas into tests.** Give each improvement a baseline, hypothesis,
   observable measure, and stopping rule before calling it an action.
8. **Protect scope.** Separate current commitments from future product ideas.
   Record the trigger that would pull a parked idea back into scope.
9. **Limit commitments.** End with at most three prioritized actions. More than
   three becomes an unowned wishlist.
10. **Close durably.** Record owner, first move, success measure, evidence, and
    stop condition so the meeting survives compaction and handoff.

## Evidence prompts

Use only when the lane is relevant:

- Human: What did the participants experience directly?
- History: Do sessions or feedback show the same pattern repeatedly?
- Behavior: What do current files, tests, receipts, or hosted checks prove?
- Qualification: Can an unfamiliar agent complete the task from public
  surfaces without rescue?
- Cost: What time, tokens, retries, or manual interventions were observed?

If evidence cannot be admitted during the meeting, propose a bounded evidence
follow-up. Keep the conclusion provisional rather than debating from memory.

## Board item shape

Write each item as:

`[class] observation -> consequence -> evidence state`

Example:

`[hypothesis] Repair hints miss terminal branches -> human rescue -> verify in session history and one frozen unfamiliar-agent run`
