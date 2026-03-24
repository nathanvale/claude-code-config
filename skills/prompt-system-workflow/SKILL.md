---
name: prompt-system-workflow
description: "Operator workflow for changing the multi-agent prompt system safely. Classifies, routes, mirrors, renders, and verifies prompt-system changes."
argument-hint: "[describe the change you want to make]"
---

# Prompt System Workflow

## Purpose

One entry point for any prompt-system change. Classifies the change, routes it to the correct surface, and verifies the result.

## Authority

This skill orchestrates the existing contract and runbooks — it does not replace them.

Read order before starting:
1. `docs/specs/prompt-system.md` — the contract (routing, rendering, rules, context, smoke tests)
2. `skills/prompt-system-router/SKILL.md` — routing classification

## Workflow

### Step 1: Classify the Change

Read the router skill and apply its classification procedure. Determine:
- What kind of instruction is this? (startup, rule, reference)
- Who needs it? (shared, Claude-only, Codex-only, future harness)
- Is mirroring required?

Present the classification to the user before proceeding.

### Step 2: Route to the Correct Surface

Based on classification, identify the exact file(s) to create or edit by consulting `docs/specs/prompt-system.md`.

Flag if the change appears to be misrouted (see router skill's misrouting patterns).

### Step 3: Implement the Change

Make the edits in the canonical source locations. Never edit generated artifacts directly.

If mirroring is required, implement the mirrored behavior in the same change.

### Step 4: Update Docs if Contract Changed

If the change modifies the composition model, delivery mechanism, or routing rules, update `docs/specs/prompt-system.md`.

Most changes do not require doc updates. Only flag this for architectural changes.

### Step 5: Render

If any prompt fragments were changed:
```bash
./scripts/render-user-prompts.sh --write
```

If only `rules/` or `context/` changed (with no fragment mirroring), skip this step.

### Step 6: Verify

Run verification in two stages:

**Stage 1 — Render and contract checks:**
Run `./scripts/render-user-prompts.sh --check` directly.

If shared behavior or propagation logic changed, also run smoke tests. Either run them directly or dispatch the `prompt-smoke-runner` agent:
- Direct: `bun scripts/multi-agent-smoke.ts`
- Subset: `bun scripts/multi-agent-smoke.ts --tests boundary,propagation`

**Stage 2 — Contract audit (when architectural):**
If the change touches the spec, runbooks, render script, or install behavior, dispatch the `prompt-contract-auditor` agent to check for drift between the spec, implementation, and runbooks.

### Step 7: Report

Summarize:
- Files changed (with paths)
- Classification used (surface, audience, mirroring)
- Verification results (pass/fail for each check)
- Residual risks (anything the automated checks cannot catch)

## Skip-Step Principle

Default to the full workflow unless the spec, the relevant runbook, or the verification surface clearly makes a step unnecessary.

When you skip a step:

- state which step you skipped
- say why it was safe to skip
- keep the reason anchored to the contract or the relevant runbook instead of personal preference
