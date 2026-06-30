# Skill Dependency Rules

Use when a skill names another skill, command, config file, data source, or owner path.

## Rule

- Label every dependency.
- Name what happens when it is missing.
- Name the next safe repair.
- Prefer owner paths over copied workflow text.
- Keep fallback references small enough to stay portable.
- Keep dependency sections as routing cards, not copied manuals.
- Do not repeat another skill's command list, state machine, flags, schemas, or full workflow.
- If a dependency section needs more than type, missing state, owner path, fallback, and next repair, move the detail to the owner path.
- Treat drift in dependency sections as evidence to shrink prose before adding a checker.
- Add a dependency audit script only after repeated unlabeled or stale helper routes survive manual review.

## Dependency Types

**Hard dependency**

- Use when the workflow cannot safely continue without it.
- If missing: return blocked state.
- Include missing owner path.
- Include next repair.

Example:

- `.productivity.yml`: hard dependency.
- Missing state: blocked.
- Next repair: provide `.productivity.yml`.

**Optional handoff**

- Use when another skill is helpful but not required.
- If available: hand off or invoke normally.
- If unavailable: use the named owner-reference fallback.

Example:

- `context-advisor`: optional handoff.
- Fallback: `skills/context-advisor/references/storage-routing.md`.

**Owner-reference fallback**

- Use when an optional handoff may be unavailable.
- Include rules, maps, safety gates, examples, and next safe action.
- Do not copy the missing skill workflow.

Example:

- `storage-routing.md` can explain where context belongs.
- It should not become a second `context-advisor` skill.

**Bundled reference**

- Use when deep notes belong inside the same skill folder.
- Keep it under `skills/<name>/references/`.
- Use it for portability.

Example:

- `skills/skill-author/references/skill-design-decision-runbook.md`.

**Blocked state**

- Use when continuing would be unsafe, fake, or ownerless.
- Say what is missing.
- Say why it blocks.
- Say the next repair.

**Degraded state**

- Use when the safe core workflow can continue.
- Say what feature is missing.
- Say what still runs.
- Do not hide the missing dependency.

## Output Shape

```text
Dependency: <name or path>
Type: hard dependency | optional handoff | owner-reference fallback | bundled reference
Missing state: blocked | degraded
Next repair: <one safe action>
```

## Checks

- No unlabeled skill-to-skill references.
- No fallback reference copies a full skill workflow.
- No hard dependency silently degrades.
- No optional handoff blocks when a named fallback exists.
- No dependency section becomes a second source of truth for another skill.
