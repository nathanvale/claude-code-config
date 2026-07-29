# Writing Agent Briefs

An agent brief is a structured comment posted on a GitHub issue when it moves
to `ready-for-agent`. It is the authoritative specification that an AFK agent
will work from. The original issue body and discussion are context; the brief
is the contract.

## Principles

### Durability over precision

Write the brief so it stays useful when files move or implementation changes.

- Describe interfaces, types, and behavioral contracts.
- Name specific types, function signatures, or config shapes when useful.
- Do not reference file paths or line numbers.
- Do not assume the current implementation structure remains unchanged.

### Behavioral, not procedural

Describe what the system should do, not how to implement it.

- Good: "`SkillConfig` accepts an optional `schedule: CronExpression`."
- Bad: "Open `src/types/skill.ts` and add the field on line 42."

### Complete acceptance criteria

Give concrete, independently testable completion criteria.

### Explicit scope boundaries

State what remains out of scope.

## Template

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line description

**Current behavior:**
Describe the current system behavior.

**Desired behavior:**
Describe the required behavior, including edge cases and errors.

**Key interfaces:**
- Type, function, or config contract and the required change

**Acceptance criteria:**
- [ ] Specific, testable criterion
- [ ] Specific, testable criterion

**Out of scope:**
- Adjacent behavior that must not change
```

## Quality Gate

Reject a brief that lacks any of:

- category
- current and desired behavior
- durable interface-level guidance
- testable acceptance criteria
- scope boundaries

Do not include stale-prone file paths, line numbers, or step-by-step
implementation instructions.
