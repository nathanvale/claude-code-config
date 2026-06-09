---
name: mvp-loop-maker
description: "Create or run reviewer findings-ledger loops when the user wants reviewers, maintainability reviewers, code reviewers, or ICA-style reviewers to keep reviewing and appending new findings until no new accepted findings remain."
role: tool-workflow
---

# Reviewer Findings Ledger Loop Maker

Use when the user wants a loop that dispatches reviewers, saves a findings ledger, passes that ledger into the next reviewer run, and stops only when reviewers add no new accepted findings.

Do not use for product discovery, PRDs, ticket breakdown, one-shot code review, or automatic fixing.

## Request Shape

- Input: seam, diff, branch, plan, skill, module, or repo area to review.
- Output: findings ledger, prompt pack, or `VISION.md` loop capture.
- Missing target: ask one question.
- Missing reviewer-dispatch tool: produce a prompt pack and mark dispatch blocked.
- Missing ledger path: default to `docs/review/<date>-reviewer-findings-ledger.md` and state the assumption.
- Existing ledger: read it before every reviewer pass.

## Loop

```text
Select target -> load findings ledger -> dispatch reviewers -> dedupe findings -> append new accepted findings -> pass ledger to next reviewers -> stop when zero new accepted findings remain
```

## Reviewer Lanes

Choose 2-5 lanes from the target risk:

- **Maintainer**: readability, change cost, naming, module boundaries.
- **New agent**: first-screen clarity, owner paths, next safe action.
- **Contract**: prose contracts, missing runtime owners, unverified behavior.
- **Testability**: observable behavior, missing checks, brittle tests.
- **ICA candidate**: seam tightness, ownership drift, duplicated responsibility.

Default lanes:

- Use maintainer, new-agent, and contract lanes for skills and docs.
- Use maintainer, testability, and contract lanes for code.
- Add ICA candidate only when the user asks for seam, architecture, ICA, or maintainability depth.

## Workflow

1. Name the review target.
2. Name reviewer lanes.
3. Create or read the findings ledger.
4. Dispatch reviewers with the ledger and read-only instructions.
5. Merge duplicate findings against the ledger.
6. Reject weak, vague, or unsupported findings.
7. Append new accepted findings to the ledger.
8. Dispatch a fresh reviewer pass with the updated ledger.
9. Repeat until the fresh pass adds zero new accepted findings.
10. Publish ledger path, pass count, accepted/rejected counts, and residual risk.

## Stop Rule

- Stop only after a fresh independent review pass adds zero new accepted findings to the ledger.
- Do not stop while reviewers still add new supported findings.
- Do not count duplicate ledger entries as new findings.
- Do not count rejected weak findings as convergence blockers.
- If reviewers keep restating ledgered findings for 3 cycles, stop and report blocked convergence with the repeated finding and likely ledger-dedupe issue.

## Validation

- Every accepted finding has file evidence or a named source artifact.
- Every rejected finding has a rejection reason.
- The ledger preserves pass number, reviewer lane, finding status, and evidence.
- The final reviewer pass adds zero new accepted findings.
- The final response names unavailable reviewer lanes and any ledger-dedupe risk.

## Findings Ledger Shape

Use this shape unless an existing ledger already has a stronger format:

```markdown
# Reviewer Findings Ledger

## Target

- [Seam, diff, branch, skill, module, or repo area.]

## Passes

- Pass 1: [lanes], [accepted count], [rejected count], [new count].

## Accepted Findings

- [P1] [lane] [finding] - evidence: [file/source]; status: accepted.

## Rejected Findings

- [P1] [lane] [finding] - reason: [weak, duplicate, unsupported, out of scope].

## Convergence

- Stop rule: fresh pass adds zero new accepted findings.
- Current state: [open | converged | blocked].
```

## Prompt Pack Fallback

If reviewer dispatch is unavailable, return compact prompts:

- Shared target context.
- Current findings ledger.
- One prompt per reviewer lane.
- Synthesis prompt.
- Ledger update prompt.
- Final no-new-findings review prompt.

## VISION.md Shape

```markdown
# Vision

## Product Bet

- Reviewer convergence will make [target] easier to maintain by repeatedly surfacing and ledgering accepted findings until reviewers find no new issues.

## Loop

- Chosen loop: Reviewer Findings Ledger Loop.
- Reviewer lanes: [Maintainer | New agent | Contract | Testability | ICA candidate].

## Target

- [Seam, diff, branch, skill, module, or repo area.]

## Stop Rule

- Stop only after a fresh review pass adds zero new accepted findings.

## Validate

- [Ledger has evidence and statuses.]
- [Final reviewer pass adds no new accepted findings.]

## Blocked Convergence

- [Repeated duplicate, unavailable tool, missing ledger path, or unresolved evidence.]

## Next Action

- [Dispatch reviewers, produce prompt pack, update ledger, or rerun final pass.]
```

## Safety

- Dispatch reviewers only when the user asks to run the loop or explicitly authorizes dispatch.
- Keep reviewer passes read-only.
- Do not fix findings inside this loop.
- Preserve unrelated user changes.
- Do not claim convergence without a final fresh reviewer pass that adds zero new accepted findings.

## Next Safe Action

- If the user asks to design the loop, return the loop shape and reviewer lanes.
- If the user asks to run the loop, dispatch reviewers when tooling is available.
- If dispatch is unavailable, return the prompt pack.
- If convergence blocks, report the repeated duplicate, ledger path, and next owner path.
