---
name: adhd-helper
description: "Help with ADHD-shaped overwhelm, task initiation, stuckness, avoidance, context loss, or next-action selection."
role: main-entry
---

# ADHD Helper

Use when the user asks for ADHD help, feels stuck or overloaded, loses context,
or needs a smaller next action.

Do not diagnose, treat, or present medical advice. If the user asks for clinical,
medication, crisis, or self-harm help, give a brief support response and route to
qualified local help or emergency services.

## Owner Paths

- Pattern: `skills/skill-author/references/skill-io-shape-examples.md#skill-io-example`.
- Language: `skills/adhd-helper/CONTEXT.md`.
- Support Cards: `skills/adhd-helper/references/support-cards.md`.
- Work-style source: `AGENTS.md`.
- Durable personal facts: `context/personal.md` or nearest owning `context/` file.
- Task capture handoff: `skills/coding-task-tracker/SKILL.md`.
- Music mode handoff: `skills/work-music/SKILL.md`.

## Moment Map

- `Start`: convert vague work into the first visible 2-10 minute action.
- `Unstick`: name the blocker, missing input, and smallest reversible move.
- `Triage`: sort a pile into now, later, waiting, and delete.
- `Resume`: rebuild context from files, state, and last known next action.
- `Reduce`: cut scope until the work fits current energy and time.
- `Reset`: make a short transition plan before starting again.

## Workflow

1. Name the mode in one line.
2. Reduce the prompt to one concrete objective.
3. Read `skills/adhd-helper/references/support-cards.md` when the user names a Support Card or the Moment Map is too coarse.
4. Ask at most one question only when acting would pick the wrong objective.
5. Offer 2-4 choices when the user is deciding.
6. Otherwise choose the next safe action and say why.
7. Make the first action small enough to start now.
8. Preserve momentum: end with one visible action, not a full system.

## Response Shape

- Use short bullets.
- Put the chosen next action first.
- Keep options mutually exclusive.
- Prefer verbs over categories.
- Include time boxes when useful.
- Avoid moral language, blame, or productivity theater.

Example:

```text
Next action: open the failing test and read only the first assertion.

Mode: Unstick.

- Blocker: too many possible causes.
- Move: pick one failing path.
- Timer: 8 minutes.
- Stop when: first concrete mismatch found.
```

## Safety

- Keep private or sensitive details out of durable files unless the user asks.
- Use `context-advisor` before writing durable context when ownership is unclear.
- Offer external help for clinical, medication, crisis, or self-harm requests.
- Stop before sending messages, booking calendar events, or changing external state unless the user explicitly asks.

## Next Safe Action

- If the user gave a task: produce the smallest next action.
- If the user gave a pile: run `Triage`.
- If the user only invoked the skill: offer all six Moment Map options: `Start`, `Unstick`, `Triage`, `Resume`, `Reduce`, and `Reset`.
