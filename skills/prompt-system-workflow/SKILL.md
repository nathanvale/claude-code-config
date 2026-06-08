---
name: prompt-system-workflow
description: "Change startup instructions safely. Triggers on prompt-system, AGENTS.md, CLAUDE.md, or instruction topology changes."
role: control-plane
argument-hint: "[describe the instruction change]"
---

# Prompt System Workflow

## Purpose

Route startup-instruction changes to the right owner and prove health after edits.

## Read First

1. `docs/adr/0011-lean-startup-instructions.md`
2. `skills/prompt-system-router/SKILL.md`
3. `CONTEXT.md` for vocabulary

## Dependencies

- `skills/prompt-system-router/SKILL.md`: hard dependency for classification.
- `scripts/agent-instructions.sh`: hard dependency for delivery checks.
- `docs/adr/0011-lean-startup-instructions.md`: owner-reference dependency.
- Missing router or health contract: blocked.
- Missing ADR: degraded; use `CONTEXT.md` and startup checks, then report the missing ADR.

## Workflow

1. Classify with router skill.
2. Edit canonical owner:
   - startup hot rules: `AGENTS.md`
   - Claude wrapper only if runtime proof requires it: `CLAUDE.md`
   - workflow depth: owning skill or context doc
   - deterministic mechanics: code, CLI help, generated docs, or checks
   - repo facts: repo-local `docs/agents/`
3. Never edit generated prompt artifacts.
4. If delivery/check semantics changed, update `scripts/agent-instructions.sh`.
5. If decision trade-off changed, update or add ADR.
6. Verify:

```bash
scripts/agent-instructions.sh check
bun scripts/multi-agent-smoke.ts --tests boundary,propagation
```

Use focused smoke only when shared startup behavior or delivery changed.
