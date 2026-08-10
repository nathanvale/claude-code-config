---
name: agent-attention
description: "Route a genuine yes/no approval blocker from a paused Codex task into Apple Reminders."
---

# Agent Attention

Use only when one explicit yes/no approval blocks the current Codex task.
Keep discussion, disagreement, multi-choice, and unclear requests in Codex.

## Owner

`runtime/agent-attention/agent-attention.py` owns admission, exact task binding,
native gate creation, structured state, delivery claims, and outcome receipts.

## Route

1. Run `bun run agent-attention submit --help` from the
   `claude-code-config` owner repo.
2. Submit the exact owning task and decision through the help-owned structured
   fields. Preview first.
3. If admitted, rerun the same command with `--execute`. One gate and one alert
   are the expected side effects.
4. If rejected, follow the returned repair or keep the decision in Codex.
5. When gated, leave the task paused. No response means no approval.
6. After exact-task delivery, apply only the stated approval meaning, run the
   continuation, then use the owner’s outcome command.

Never infer approval from prose. Never create a second gate for the same
request. Never delete or reopen the completed reminder.

## Next safe action

Start with the `submit` preview. Stop on owner-state repair, missing EventKit
access, or an exact Reminders approval gate.
