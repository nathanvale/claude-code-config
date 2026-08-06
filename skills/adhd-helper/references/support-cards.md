# Support Cards

Source owner: `skills/adhd-helper/SKILL.md`.
Language owner: `skills/adhd-helper/CONTEXT.md`.

Use when the user names a Support Card or when the Moment Map is too coarse.

## Shared Safety

- Keep this as executive-function support, not medical, clinical, therapy, medication, crisis, or self-harm advice.
- Keep private or sensitive details out of durable files unless the user asks.
- Stop before sending messages, booking calendar events, changing trackers, or writing durable context unless the user explicitly asks.
- Use `skills/coding-task-tracker/SKILL.md` for task capture handoff.
- Use `skills/work-music/SKILL.md` for music mode handoff.
- Use `context-advisor` before durable context writes when ownership is unclear.
- Give one visible action before expanding a large plan.
- Treat examples as illustrative, not contracts.

## Card Shape

Each card carries:

- Cue.
- Moment.
- Pairs with, when useful.
- Output shape.
- Tiny example.
- Safety note, only when the card has a special risk.

## Cards

### Get Me Started

- Cue: user is avoiding a task or cannot find the first move.
- Moment: `Start`.
- Pairs with: `Reduce`.
- Output shape:
  - First visible 2-5 minute action.
  - 10-minute version.
  - Good-enough finish.
  - Tiny reward.
  - Resistance reducer.
- Tiny example:

```text
Next action: open the draft and write only the first ugly sentence.

Mode: Start.
- Timer: 5 minutes.
- Good enough: one sentence exists.
- Reward: stand up and refill water.
- Resistance: this is a start, not a quality test.
```

### Turn Chaos Into a Plan

- Cue: user gives a brain dump, pile, or too-many-things list.
- Moment: `Triage`.
- Pairs with: `Reset`.
- Output shape:
  - Now.
  - Later.
  - Waiting.
  - Delete.
  - Top 1-3 actions.
  - Done line for each action.
- Tiny example:

```text
Next action: pick the one item that unblocks another person.

Mode: Triage.
- Now: reply to Sam with the missing date.
- Later: clean notes.
- Waiting: invoice PDF.
- Delete: reread old thread.
```

### Body Double Mode

- Cue: user wants a calm work-along presence.
- Moment: `Start`.
- Pairs with: `Resume`.
- Output shape:
  - Setup checklist.
  - Sprint length.
  - Exact first action.
  - Check-in prompt.
  - Closeout baton.
- Tiny example:

```text
Next action: set a 15-minute timer and open the failing file.

Mode: Start.
- Setup: water, tab closed, file open.
- Check-in: return with done, blocker, next.
- Stop when: timer ends or first mismatch appears.
```

Safety note: keep check-ins user-initiated. Do not create background nudges or durable mission state.

### Dopamine-Friendly Work Plan

- Cue: user says the task feels boring, flat, or unrewarding.
- Moment: `Reduce`.
- Pairs with: `Start`.
- Output shape:
  - Small level.
  - Visible progress marker.
  - Simple reward.
  - Novel start.
  - Stop rule.
- Tiny example:

```text
Next action: make a three-item checklist and tick the first box.

Mode: Reduce.
- Level 1: rename the file.
- Progress: one checkbox.
- Reward: play one track after the first tick.
- Stop when: the first visible change exists.
```

Safety note: avoid pseudo-clinical dopamine claims, streak pressure, and points systems by default.

### Finish The Thing

- Cue: user started but keeps stopping near the end.
- Moment: `Reduce`.
- Pairs with: `Unstick`.
- Output shape:
  - Minimum finished version.
  - Next 3 steps only.
  - Time estimate per step.
  - Perfectionism release.
  - Clear finish line.
- Tiny example:

```text
Next action: write the missing final paragraph as bullets.

Mode: Reduce.
- Minimum finish: bullets are acceptable.
- Step 1: list the three claims.
- Step 2: add one sentence each.
- Step 3: send or park.
- Finish line: no blank ending remains.
```

### Smallest Durable Fix

- Cue: user asks why a direct fix is not enough, challenges a proposed system as too elaborate, or wants the smallest solution that will stay fixed.
- Moment: `Reduce`.
- Pairs with: `Unstick`.
- Branch override: lead with the verdict, omit the Mode label, and put one decision or action last.
- Output shape:
  - Direct verdict: agree, disagree, or partly agree.
  - One correction when the user's proposed invariant would break valid behavior.
  - Up to three levels: shortcut, smallest durable fix, expanded system.
  - One clear pick with confidence and a root-cause reason.
  - Explicitly deferred complexity.
  - One visible reply or action.
- Tiny example:

```text
You're mostly right. One correction: keep one package owner, not necessarily one worker.

1. Cleanup only: fastest, but recurrence remains.
2. Focused fix: clean up, repair the known cause, and pin one regression test.
3. Full system: add reusable diagnostics and broader automation.

Pick: 2. It is the smallest option that prevents the known recurrence.
Deferred: build the full system only after repeat evidence.
Next: reply 2 to accept the reduced scope.
```

Safety note: do not confuse reduced scope with symptom-only cleanup. Keep the smallest guard or test that prevents the known cause, and do not implement an analysis-only choice before the user accepts it.

### Anti-Procrastination Reframe

- Cue: user names procrastination, dread, avoidance, or stuckness.
- Moment: `Unstick`.
- Pairs with: `Start`.
- Output shape:
  - Likely blocker.
  - One short question, only when needed.
  - Smallest reversible action.
  - 15-minute starter.
  - 5-minute fallback.
  - Gentler reframe.
- Tiny example:

```text
Next action: find the exact missing input.

Mode: Unstick.
- Blocker: unclear finish line.
- Starter: make a two-column list, done and unknown.
- Fallback: write one unknown only.
- Reframe: avoidance is signal, not a character flaw.
```

Safety note: do not diagnose. Do not use therapy voice or shame language.

### Task Translator

- Cue: user has a vague goal that needs concrete actions.
- Moment: `Start`.
- Pairs with: `Triage`.
- Output shape:
  - Objective.
  - Working input.
  - Output owner.
  - Missing input.
  - First action.
  - Low-energy restart step.
- Tiny example:

```text
Next action: turn "fix docs" into one owned output.

Mode: Start.
- Objective: update the install note.
- Input: README section.
- Owner: README.
- Missing: command output.
- Restart: open README and find "Install".
```

### Decision Helper

- Cue: user is choosing between options.
- Moment: `Unstick`.
- Pairs with: `Triage`.
- Output shape:
  - 2-4 options.
  - Lowest-risk option.
  - Lowest-energy option.
  - Reversible default.
  - One 10-minute action.
- Tiny example:

```text
Next action: choose the reversible option and test it for 10 minutes.

Mode: Unstick.
- Option A: smaller, reversible.
- Option B: stronger, slower.
- Pick: A, because it creates evidence.
- Move: try A on one file.
```

Safety note: stop before purchases, messages, bookings, medical, crisis, relationship diagnosis, or external state changes unless the user explicitly asks.

### Overwhelm Reset

- Cue: user feels overloaded and wants the agent to choose.
- Moment: `Reset`.
- Pairs with: `Triage`.
- Output shape:
  - 60-second reset.
  - One task first.
  - Easiest starting step.
  - 20-minute action plan.
  - Clear stopping point.
- Tiny example:

```text
Next action: close every tab except the one task file.

Mode: Reset.
- Reset: breathe, feet on floor, name the room.
- First task: the item with a waiting person.
- Start: open the file.
- Stop when: one reply or handoff exists.
```

Safety note: keep raw overwhelm dumps private unless the user asks to capture them.

### 4-Hour Deep Work Sprint

- Cue: user has a larger block and wants structure.
- Moment: `Start`.
- Pairs with: `Resume`.
- Output shape:
  - Setup ritual.
  - First block only.
  - Break cue.
  - Distraction capture.
  - Good-enough output.
  - Continuation baton.
- Tiny example:

```text
Next action: set up the first 25-minute block, not the whole four hours.

Mode: Start.
- Setup: water, notes, timer.
- Block 1 goal: produce rough outline.
- Capture: write distractions below the line.
- Good enough: headings exist.
- Baton: done, risk, next action.
```

Safety note: treat four hours as an optional horizon, not a promise. Expand after the first block or when the user asks.
