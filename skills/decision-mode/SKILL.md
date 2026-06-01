---
name: decision-mode
description: Guides collaborative planning, product design, architecture, and implementation choices at real decision boundaries. Use when the user asks for Decision Mode, explicitly asks for a decision, or a discussion has multiple viable options, ownership/scope/reversibility impact, user-outcome tradeoffs, or architectural or implementation consequences.
---

# Decision Mode

Use Decision Mode only when there is a real choice in collaborative planning,
product design, architecture, or implementation discussion. Otherwise, answer
normally.

## Trigger

Use the hybrid trigger:

- Always enter Decision Mode when the user explicitly asks for it with phrases
  such as `Decision Mode`, `decide`, `pick`, `choose`, or natural decision
  intent like "which approach?", "tradeoffs?", "what should we do?", or "is this
  the right boundary?"
- Otherwise enter Decision Mode only when the agent is about to choose between
  real options, ask the user to choose, or make a silent choice that could
  create avoidable entropy.

Do not use Decision Mode for simple Q&A, factual explanation, code explanation,
or routine execution. During implementation, continue with the safe default
unless a new real fork appears.

If the user explicitly asked for Decision Mode but there is no real choice,
briefly say why Decision Mode is not needed and proceed normally. If the user
did not explicitly ask, skip the ceremony and answer normally.

## Real Choice Test

A real choice has at least one of:

- Two or more viable options.
- Ownership, scope, or reversibility impact.
- Meaningful user-outcome tradeoff.
- Architectural or implementation consequence.
- The user explicitly asks for a decision.

For reversible details, state the safe default and continue.

## Style

Keep it low-friction, high-signal, dopamine-friendly, lightly fun when natural,
and architecturally disciplined. Optimize for ADHD: reduce cognitive load, make
progress visible, keep choices small, use whitespace, and prefer concrete
examples.

Help make decisions that reduce entropy. Prefer choices that clarify ownership,
simplify mental models, improve handoff, and avoid unnecessary abstraction or
drift.

## Timebox

- **Quick**: 2 minutes, reversible or low-risk.
- **Standard**: 5 minutes, default.
- **Deep**: 15 minutes, only when ownership, scope, architecture, or product
  direction is at stake.

Normal Decision Mode should fit roughly 180-300 words. Use 3-5 sections, not
every section every time.

## Output Contract

- **Win**: what this unlocks, clarifies, or makes easier. Keep it short.
- **Choice**: ask one decision only. Offer 2-3 numbered options with one-line
  tradeoffs.
- **My Pick**: give exactly one option number plus a confidence label, or `Hold`
  plus the missing information needed before choosing.
- **Next**: tell the user to reply with an option number, `riff | r`,
  `visualise | v`, or `why?`.

Confidence labels:

- **Strong Pick**: enough context, low downside.
- **Soft Pick**: reasonable default, but context could change it.
- **Hold**: choosing now may create avoidable entropy.

Optional sections: **Visual** for tiny Mermaid / ASCII / table aids, **Why** for
minimal reasoning or deeper teaching after `why?`, **Explain** for key terms,
**Exceptions** for material edge cases, and **Drift** for remaining entropy,
ownership, handoff, or follow-up risk.

Use [REFERENCE.md](REFERENCE.md) for examples, DDD language, and response
control details.

## Decision Discipline

- Ask one decision at a time.
- If the decision is too large, name the larger decision, pick the smallest
  useful sub-decision, and ask only for that answer.
- If the conversation drifts, restate what is actually being decided.
- After the user chooses, briefly restate the accepted decision and next step.
- If the decision should become durable, name the likely owner: plan, ADR,
  `CONTEXT.md`, `AGENTS.md`, package map, or runbook. Ask before editing.
