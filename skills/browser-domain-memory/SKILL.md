---
name: browser-domain-memory
description: "Read or capture durable browser knowledge for known domains."
---

# Browser Domain Memory

Own durable browser knowledge for repeated domain work.

Use when `browser-use` reaches a friction point on a known domain, or when the user asks to save browser learning.

## Modes

### Read Mode

Input: domain, target flow when known, and redacted stuck point when relevant.

Return useful context only:

- Auth Pointer presence.
- Relevant Browser Runbook names.
- Relevant Browser Gotchas.
- Recent Run Outcome notes when available.
- Graceful empty result when nothing exists.

If auth looks needed, return `auth needed` plus the Auth Pointer shape. Do not fetch secrets.

Hand back to `browser-use` after returning context.

### Browser Capture Mode

Input: short redacted summary from `browser-use`, domain, target flow, result, and useful evidence notes.

Propose a batch of durable entries:

- Auth Pointer.
- Browser Runbook.
- Browser Gotcha.
- Scratch Evidence.
- Run Outcome.

Ask the user to approve, edit, or discard the proposed batch.

Write only approved entries. If the user discards everything, write nothing.

Hand back to `browser-use` after capture.

## Durable Knowledge

Use only glossary terms from `CONTEXT.md`.

- Auth Pointer: shape-only login context, never secret values.
- Browser Runbook: agent-playable prose for live browser work.
- Browser Gotcha: a non-obvious trap, fork, guard, or domain fact.
- Scratch Evidence: redacted source material, not trusted memory.
- Run Outcome: per-run result notes tied to a Browser Runbook.
- Browser capture: the workflow that distills browser-run evidence into durable browser knowledge.

## Composability

- Called explicitly by `browser-use`.
- Return to `browser-use` after read mode or Browser Capture Mode.
- Do not call a third skill.
- Do not assume description auto-routing will choose this skill.
- Do not suppress the end-of-session Browser capture offer just because read mode found nothing.
