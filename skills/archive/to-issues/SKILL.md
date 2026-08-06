---
name: to-issues
description: "Split an accepted plan or spec into independently grabbable implementation tickets using tracer-bullet vertical slices. Not for writing a PRD."
role: tool-workflow
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

## Dependencies

- Issue tracker map: `docs/agents/issue-tracker.md`.
- Triage label map: `docs/agents/triage-labels.md`.
- Domain map: `docs/agents/domain.md`.
- Missing state: blocked for publishing; continue for draft-only breakdown.
- Next repair: add the missing `docs/agents/` owner file or ask for the tracker target.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (issue number, URL, or path) as an argument, fetch it from the issue tracker and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Use the project's domain glossary vocabulary in issue titles and descriptions. Respect ADRs in the area you're touching.

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user to review:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Accept structured replies:

- Reply `approve` if the breakdown is ready.
- Reply `split <number>` when a slice is too broad.
- Reply `merge <numbers>` when slices belong together.
- Reply `move <number> after <number>` when dependencies are wrong.
- Reply `mode <number> HITL|AFK` when an interaction mode is wrong.

Iterate until the user approves the breakdown.

### 5. Publish the issues to the issue tracker

For each approved slice, publish a new issue to the issue tracker. Use the issue body template below. These issues are considered ready for AFK agents, so publish them with the correct triage label unless instructed otherwise.

Publish issues in dependency order (blockers first) so you can reference real issue identifiers in the "Blocked by" field.

### 6. Verify published issues

After publishing, read back each created issue from the tracker.

Verify:

- title matches the approved slice
- body includes `What to build`, `Acceptance criteria`, and `Blocked by`
- triage label matches the approved HITL / AFK intent
- dependency links point to real created issue identifiers

Report the created issue IDs or URLs.

### Issue body template

<issue-template>
## Parent

A reference to the parent issue on the issue tracker (if the source was an existing issue, otherwise omit this section).

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- A reference to the blocking ticket (if any)

Or "None - can start immediately" if no blockers.
</issue-template>

Do NOT close or modify any parent issue.
