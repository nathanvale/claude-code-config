---
status: accepted
date: 2026-05-22
---

# Runbooks and Skills Use Prose as Orchestrator

Runbooks and skills in this repo should use prose for orchestration, judgment, role choreography, user gates, and stop conditions. Deterministic mechanics should live behind a CLI, script, or runtime validator. Runtime contracts should live in code, repeated cross-agent handoffs should live in templates, and rare background explanation should live in one-level references.

The placement rule is:

```text
Judgment goes in prose.
Determinism goes behind a CLI or script.
Runtime contracts go in code.
Repeated handoffs go in templates.
Rare explanation goes in references.
README files are maps, not policy manuals.
```

This decision applies repo-wide. Issue-to-PR is the motivating case, but the boundary is not specific to that workflow.

## Consequences

- A runbook or skill may define the workflow route, authority boundaries, required reads, user confirmations, and fail-stop conditions in prose.
- A runbook or skill should not manually encode large deterministic contracts in prose when a script can validate or emit them.
- When a workflow needs parsing, validation, normalization, rendering, digesting, routing, extraction, deduplication, or schema emission, that operation belongs behind a CLI or script.
- Runtime contract values such as allowed statuses, required fields, schema keys, and command metadata should live in code that the CLI uses at runtime. TypeScript types alone are not enough because they are erased at runtime.
- The CLI should be the deterministic front door for commands the runbook needs. The prose orchestrator decides when to call it and what to do with the result.
- Templates own repeated prompt payloads such as Builder packets, Validator prompts, planning addenda, and patch proposals. XML-style tags are appropriate inside templates when they clarify role, authority, durable inputs, evidence, stop conditions, and output contracts.
- References own detailed or rarely needed explanation. Keep references one level deep from the hot runbook or skill entrypoint.
- README files should explain purpose, invocation, file layout, and compatibility. They should not compete with the runbook or skill as a second policy manual.
- Small instruction-only skills do not need a CLI. Add a deterministic tool only when the skill would otherwise ask agents to perform repeatable mechanical work from prose.
- Existing runbooks can migrate incrementally: first identify which prose is orchestration versus deterministic contract, then move deterministic parts behind scripts without weakening the workflow gates.
