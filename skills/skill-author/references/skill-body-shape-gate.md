# Skill Body Shape Gate

Use when shaping `SKILL.md`, headings, first-screen behavior, examples, run cards, or branch-hidden references.

## Skill Body

- Keep `SKILL.md` as a `thin router`, not the operating manual.
- First-screen budget: include only text that changes route, halt, or continuation for the selected branch.
- Keep trigger, boundary, branch choice, and next safe action visible only when they affect the `current step only`.
- Add an immediate fail-closed gate only when it can block the current branch before action.
- Name one owner anchor only when route, halt, or continuation depends on it.
- Put exhaustive owner maps, verification matrices, rare branches, command recipes, trust models, branch workflows, examples, and troubleshooting behind `branch-hidden reference` pointers.
- Tell the agent which reference to read only after branch selection.
- Move depth into one-level `references/`.
- Move repeated deterministic work into `scripts/`.
- Use Markdown headings unless a host runtime requires another format.
- Start heading choice from input/output shape, not `role`.
- Reject pure XML skill-body structure.
- Use XML-like tags only inside prompt packets, examples, or quoted inputs when boundary clarity beats Markdown.

## Default Continuation

- Every active skill needs one no-args continuation.
- Use one line when no-args behavior is obvious.
- Add `## Intent Classification` or `## Next Safe Actions` only when the heading changes route, halt, or continuation.
- Use a numbered menu only when user choice changes owner, risk, target, or next action.
- Use `references/adhd-friendly-dx.md` for multi-choice flows.
- Review-only runs flag missing no-args continuation in findings.

## Run Card

- Use `references/run-card-template.md` only when a workflow is long, branching, slow, side-effectful, or needs several verification passes.
- Do not retrofit an existing skill only to add the pattern.
- Keep Run Card bullets to first-minute route, halt, continuation, or visible-state decisions.
- Move branch-specific run-card bullets into branch-hidden references.

## Heading Pruning

- Apply the `deletion test` before handoff: if deleting text does not change agent behavior for the selected branch, delete it or move it to a `branch-hidden reference`.
- In source-edit handoff, report `deletion test`: kept, moved, deleted, or none.
- Treat headings as options, not a checklist.
- If `Owner Map`, `Workflow`, `Next Safe Action`, `Verification`, and `Safety` all appear, file a review finding by default until each heading passes the `deletion test`.
- Use `references/skill-io-shape-examples.md#heading-selection-matrix` when heading choice is unclear.
