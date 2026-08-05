# Context Unhobble Audit Lens

Use after the target and context surfaces are mapped.

## Source

- Thariq Shihipar, Anthropic, "The new rules of context engineering for Claude
  5 generation models":
  `https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models`
- Checked: 2026-08-04.

The article reports that Claude Code removed more than 80% of its system prompt
for newer models without measurable loss on its coding evaluations. That is
evidence for testing accumulated scaffolding, not a universal deletion target.

## Six Reversals

| Then | Now |
| --- | --- |
| Give rules | Let the model use judgment from surrounding context |
| Give examples | Design expressive interfaces |
| Put everything upfront | Load context progressively |
| Repeat instructions | Put concise guidance with the owning tool |
| Store memory in startup files | Use automatic memory for relevant recall |
| Use simple prose specs | Prefer rich references such as code, tests, artifacts, and rubrics |

The retired "default to no comments" instruction is an example of
overconstraint. The replacement is to match the surrounding code's comment
density, naming, and idiom.

## Audit Surfaces

- System and startup instructions.
- Root and path-scoped `AGENTS.md` or `CLAUDE.md` files.
- Active `SKILL.md` entrypoints and their loaded references.
- Tool descriptions, schemas, help, wrappers, and examples.
- Hooks, deterministic guards, runtime contracts, and generated docs.
- Manual memory, session summaries, logs, and operational state.
- Specs, plans, tests, code exemplars, artifacts, and rubrics.

Historical or retrieval-only documents enter scope only when an active route
loads them or they compete with a current owner.

## Anti-Patterns

### Overconstraint

- Universal rules for contextual decisions.
- Blanket comment, documentation, planning, or artifact bans.
- One permanent rule added after every isolated failure.
- Old-model workarounds retained without a current evaluation.
- Worst-case safeguards applied to harmless work.
- Style rules that ignore surrounding code.
- Defaults that fight explicit user intent.
- Lower-authority skills overriding repo or runtime owners.
- Multiple active surfaces giving incompatible instructions.
- Safety boundaries enforced only through prompt compliance.
- Strong language without an enforceable consequence or check.

### Examples Instead Of Interfaces

- Worked examples acting as the tool contract.
- Example JSON acting as the schema.
- Example commands defining accepted flags.
- Examples encoding allowed states or transitions.
- Many examples covering slight variations.
- Copied command recipes across callers.
- Prose compensating for weak tool parameters.
- Agents parsing structured arguments from prose.
- Agents normalizing deterministic input from prose.
- Output examples replacing a renderer or contract.
- Required invariants communicated through repeated reminders.

### Failed Progressive Disclosure

- Catch-all startup instructions.
- Catch-all skills.
- Whole workflows loaded for every branch.
- Verification instructions loaded before relevant work.
- Rare recovery recipes on the first screen.
- Deep-mode guidance loaded during a brief path.
- Every tool definition loaded before selection.
- Branch-only output formats kept in `SKILL.md`.
- Long skills without branch-hidden references.
- Routers that repeat everything they route to.
- Re-reading a full control plane every turn.
- Split files that are still all loaded together.
- Detailed implementation history in active guidance.

### Repetition And Misplaced Ownership

- One instruction repeated in startup and skills.
- One gotcha repeated in an owner and every caller.
- Tool flags copied outside tool help or schema.
- Route IDs copied from runtime code into prose.
- Error strings duplicated across workflow layers.
- State transitions restated in several sections.
- The same reminder at the beginning and end of a skill.
- Tool usage described in both startup and tool definitions.
- Callers owning authentication or transport mechanics.
- Generated contracts manually copied for readability.

### Memory And State

- Rare personal facts always loaded.
- Session summaries accumulated as permanent context.
- Append-only logs loaded on every invocation.
- Current operational state stored in instructions.
- Old plans or brainstorms still marked active.
- Memory duplicated between startup and context files.
- Manual memory used for facts automatic memory can recover safely.
- Automatic memory trusted for critical contracts.
- Conversation recall trusted over inspectable runtime state.
- Ephemeral state mixed with durable product knowledge.

### Weak References

- Markdown field tables replacing typed schemas.
- Prose state machines replacing executable workflows.
- Natural-language acceptance criteria replacing tests.
- Output samples replacing code-owned renderers.
- Screenshots replacing inspectable artifacts when source can be supplied.
- Abstract design taste replacing a rubric.
- Documentation describing code that can be referenced directly.
- Lossy summaries replacing existing implementations.
- Plans remaining authoritative after implementation changes.
- Rich references available but ignored by the workflow.

### Context Hygiene

- Obvious filesystem facts in startup instructions.
- Generic advice the target model already handles.
- Skills carrying generic industry advice instead of local knowledge.
- Important gotchas buried beneath boilerplate.
- Model-specific workarounds applied to every model.
- No retirement check after a model or tool upgrade.
- An arbitrary percentage used as a deletion goal.
- Token count optimized without measuring task quality.
- Safety weakened to make prompts shorter.

## False-Positive Guards

Do not report these by themselves:

- Many code comments.
- A long retrieval-only reference.
- A large test suite or code exemplar.
- Explicit secret, destructive-action, or authority boundaries.
- Repo-specific conventions invisible from code or tooling.
- Repetition across mutually exclusive runtime surfaces.
- Markdown used as a navigation or judgment surface.
- Durable runtime state stored outside startup context.

## Finding Tests

### Conflict

- Can both instructions be followed in the same request?
- Which surface has authority?
- Does the conflict consume reasoning or cause inconsistent action?

### Obsolete Scaffolding

- Which historical failure created the rule?
- Does a current model, tool, hook, or test still need it?
- What evaluation can compare retained versus removed guidance?

### Eager Loading

- Which requests receive the context?
- Which subset actually needs it?
- Is there a reliable route to load it later?

### Interface Gap

- Is prose teaching an enumerable or parseable contract?
- Can help, schema, typed parameters, code, or tests express it directly?
- Would removing examples make the interface ambiguous?

### Repetition

- Are repeated statements active in the same request?
- Is one copy the owner and the rest only reminders?
- Can callers point to the owner without losing a safety stop?

### Reference Quality

- Does the reference preserve the source's fidelity?
- Would code, tests, an artifact, or a rubric communicate better?
- Can both the agent and human inspect it?

## Retention Test

Keep guidance when at least one applies:

- It protects a real safety or authority boundary.
- It records a non-obvious repo-specific gotcha.
- It supplies product knowledge unavailable elsewhere.
- It routes to the smallest sufficient owner.
- It defines judgment that code cannot decide.
- Removing it makes a scoped evaluation worse.

Prefer deletion, relocation, or substitution when none applies.
