---
name: improve-test-architecture
description: "Explicit whole-suite test architecture review, visual candidates, or proof-boundary improvements."
disable-model-invocation: true
---

# Improve Test Architecture

Review a selected test suite without changing it. Invocation must be explicit.

## Workflow

1. Read the repository instructions, testing commands, relevant context, and accepted decisions.
2. Read `skills/test-design/references/pattern-library.md`, then every profile reference relevant to the selected suite.
3. Map production-consumer workflows, behaviour claims, seams, proof layers, fixtures, helpers, harnesses, and expensive boundaries.
4. Check each claim against the shared patterns and relevant profiles.
5. Produce three to five bounded improvement candidates and one recommendation.
6. Build the visual report through `references/html-report.md`.
7. Ask Nathan to select a candidate. Until Nathan selects, change no tests, fixtures, mocks, snapshots, helpers, harnesses, or production code.

Each candidate includes:

- Behaviour or confidence claim.
- Current proof and remaining blind spot.
- Proposed seam or sensitivity proof.
- Expected confidence gain.
- Cost, risk, and affected owners.
- Smallest next slice.

## Handback

After selection, return control to the active driver for `grilling` and `domain-modeling` when terminology or boundaries remain unsettled. Before any repository-test artifact edit, the driver invokes `test-design`, completes its brief, and returns to the selected improvement workflow.

Next safe action: open the temporary report and ask Nathan to select one candidate.
