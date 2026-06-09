# Skill Design Philosophy

Default model for authoring, reviewing, healing, and repairing portable `SKILL.md` files from this repo.

Vocabulary owner: `../CONTEXT.md`.
Agent-native CLI vocabulary owner: `../CONTEXT.md`.

## Preview Index

- Read `Core Rule` and `Shape` for the default skill model.
- Read `Frontmatter`, `Naming And Descriptions`, and `Invocation Reliability` for routing evidence.
- Read `Progressive Disclosure` and `Body` before adding depth.
- Read `Owner Paths` before moving deterministic contracts.
- Read `Skill I/O Examples`, `Simple Operation I/O`, and `Runtime-Backed Capability Design` when deciding whether prose, script, or runtime owns input/output behavior.
- Read `references/skill-io-shape-examples.md#heading-selection-matrix` when choosing `SKILL.md` body headings.
- Read `Evidence Loop` and `Skill Evolution` before adding rules.
- Read `Quality Checks`, `Safety Prose`, and `Composition` before handoff.

## Core Rule

- Contracts where a machine parses.
- Prose where a model reasons.
- Skill bodies provide entry-screen route clarity: request shapes, owner paths, references, scripts, and next safe actions.
- Code, CLI help, generated docs, tests, and scripts own deterministic behavior.
- Never copy flags, schemas, state machines, output semantics, or generated shapes into `SKILL.md`.

## Shape

```text
skills/<name>/
  SKILL.md          required; trigger, workflow, commands, owner paths
  scripts/*         optional; deterministic helpers or CLIs
  references/*.md   optional; one-level-deep detail
```

- Most skills are one file.
- Add `scripts/` only for repeated deterministic work.
- For package-backed runtime files, read `runtime-portability.md` before choosing `scripts/` or `src/`.
- Add `references/` only when depth would bloat `SKILL.md`.
- Avoid `scripts/` plus `references/` plus extra machinery unless the skill is genuinely large.

## Frontmatter

- Use `name` plus quoted `description`.
- Match `name` to the directory unless a runtime requires an alias.
- Treat published skill names as stable skill routing surfaces.
- YAML-parse after edits.

## Naming And Descriptions

- Use names for humans.
- Use descriptions as routing evidence.
- Write descriptions as trigger conditions, not summaries.
- Front-load domain nouns and trigger phrases.
- Add `when not` only when a nearby skill collision exists.
- Resolve skill collisions in descriptions before body prose or skill-driver handoffs.
- Name action skills with a verb or verb phrase.
- Name reference skills with a noun or noun compound.
- Name agent skills with a role noun.
- Avoid broad catch-all descriptions that compete with many tasks.
- Exclude personal names unless routing requires them.
- Treat published skill names as stable skill routing surfaces.
- Rename published skills only with a skill bridge, owner path, and removal condition.
- Make skill bridges temporary by default.
- Remove skill bridges after reference audit shows no live old-name references remain.
- Keep skill bridge metadata in prose until skill bridge clutter earns a schema or check.
- Do not add a skill bridge checker until repeated old-name references, stale skill bridges, or skill bridge clutter show manual reference audit is failing.
- Do not run standalone old-skill alias wrapper cleanup without rename evidence, old-name references, or a selected scoped audit.
- Require explicit justification for permanent alias wrappers.

## Invocation Reliability

- Treat automatic skill routing as useful routing evidence, not guaranteed skill invocation.
- Choose invocation mode deliberately: auto, manual command, model-only, user-only, or path-scoped.
- Provide a manual fallback when missed invocation would lose data, mutate state, or bypass safety.
- Name the fallback route: command, slash invocation, driver handoff, hook owner, or owner path.
- Keep descriptions budget-aware; routing context is finite.
- Audit and patch descriptions when skill routing misses, over-matches, or creates skill collisions.
- Audit descriptions after observed routing failure, nearby skill collision, skill rename, or review/healing of the touched skill.
- Run `bun run skills/create-skill/scripts/skill-description-audit.ts --json` after adding a skill, renaming a skill, or changing skill descriptions.
- Treat skill collision warnings as routing evidence review prompts, not automatic rewrite orders.
- Do not add periodic description audits until repeated observed failures show event-triggered review is insufficient.

## Progressive Disclosure

- Treat skills as folders, not prompts.
- Put trigger, boundary, owner paths, safety gate, and next safe action in `SKILL.md`.
- Tell the agent which files exist and when to read them.
- Keep the first screen small and route-complete with entry-screen route clarity.
- Move depth into one-level `references/`.
- Move repeated deterministic work into `scripts/`.
- Route package-backed runtime shape through `runtime-portability.md`.
- Use assets or templates when output shape matters.
- Do not hide required context in unreferenced files.
- Avoid copying reference detail back into `SKILL.md`.

## Body

- Write terse prose plus commands.
- Write triggers, not essays.
- Give the next safe action.
- Prefer examples over abstract explanation.
- Keep one workflow per skill.
- Use references for depth, one level down.
- Delete prose that does not change behavior.
- Use Markdown headings for `SKILL.md` sections unless a host runtime requires another format.
- Use the Heading Selection Matrix when heading choice is unclear.
- Start heading choice from input/output shape, not `role`.
- Reject pure XML skill-body structure; current Codex and Claude Code skills use YAML frontmatter plus Markdown instructions.
- Use XML-like tags only inside prompt packets, examples, or quoted inputs when boundary clarity beats Markdown.
- Keep helper-validated YAML, JSON envelopes, Markdown references, CLI help, and generated docs outside XML wrappers; those surfaces already have owners.
- Treat legacy `create-agent-skills` XML rules as extraction rejects unless a scoped prompt-boundary example is worth moving.

## Owner Paths

- Name the owner path instead of copying the contract.
- Runtime-backed capability docs name commands and env vars for entry-screen route clarity only.
- Code/help/tests own flags, schemas, state machines, validation rules, and output semantics.
- Script-backed skills name a focused `## Verification` path on the first screen.
- Use script-local `test`, `typecheck`, or narrow smoke commands when available.
- Keep generated caches, output folders, and dependency folders out of ownership unless promoted as evidence.
- Use headings like `## Owner`, `## Commands`, `## Verification`, `## Safety`, `## Known Pitfalls`.
- Use `## Contract` only to point at the authoritative owner path.

## Agent-Native I/O

- Use `create-cli` before adding or changing agent-facing CLI surfaces.
- Let command contracts own exact input envelopes, output envelopes, status values, hints, repair actions,
  diagnostics, observability fields, and retry semantics.
- Keep `SKILL.md` focused on when to call the command and which owner path defines the contract.
- Prefer prose-friendly input fields when agents or humans supply intent.
- Require explicit fields for ambiguity that changes side effects, ownership, or durability.
- Return parseable output for every path, including missing input, out-of-scope input, and blocked writes.
- Include run correlation, side-effect stance, mutation evidence, same-input retry safety, and next safe action.
- Use hints and repair actions to tell the skill driver what to change, inspect, retry, or hand off.
- Keep examples illustrative; keep machine-checked shapes in runtime code, help, tests, or generated docs.

## Flexibility

- Give constraints, maps, gotchas, and owner paths.
- Avoid brittle step sequences unless the operation is fragile.
- Escalate fragile operations to scripts, checks, or runtime contracts.
- Let the agent choose tactics inside the named boundary.

## Community Skill Pattern

- Read `references/community-skill-research-sources.md` before changing community-skill rules.
- Treat community skill categories as examples, not architecture.
- Classify artifact skills by model-written output shaped by examples.
- Classify simple operation skills by command recipes with args, stdout, stderr, and exit codes.
- Classify runtime-backed capabilities by parsed input, machine-readable output, repair, retry, or durable mutation.
- Use the smallest shape that handles the risk.
- Add scripts, schemas, or facade envelopes only when the operation needs mechanical reliability.
- Treat marketplace, awesome-list, and repo examples as research inputs, not trusted contracts.
- Update the source note when a community-skill rule changes because of external docs, papers, marketplace examples, or public repos.

## Skill I/O Examples

- Use this pattern when a skill shapes model-written artifacts: commit messages, summaries, reports, PR descriptions, prompts, or review notes.
- Put short illustrative input and output examples in `SKILL.md` or `references/`.
- Keep examples non-authoritative.
- Promote examples to runtime contracts only when code, help, generated docs, or tests enforce them.

## Simple Operation I/O

- Use this pattern for ordinary commands with args, flags, stdin, stdout, stderr, and exit codes.
- Use it when `--help` plus tests can own the contract.
- Use plain stdout for scalar, list, or short text results.
- Use small JSON only when callers need structure.
- Keep diagnostics on stderr.
- Skip facade envelopes when no agent needs repair, retry, mutation evidence, or safety data.
- Escalate to runtime-backed capability design when side effects, privacy, ownership, acceptance, durable writes, or autonomous recovery enter the flow.

## Runtime-Backed Capability Design

- Read `references/agent-native-skill-design.md` when a skill needs runtime-backed behavior.
- Use this pattern for runtime-backed capabilities.
- Use it when a skill calls helper commands, mutates durable state, emits machine-readable output, or exposes repair and retry behavior.
- Use it when a stressed human or autonomous agent needs to operate without guessing.
- Use it when input ambiguity changes side effects, ownership, privacy, durability, or acceptance.
- Use it when output drives another tool, script, agent, CI check, or handoff.
- Use it when failures need no-mutation evidence, mutation evidence, retry safety, or next repair action.
- Skip it for prose-only skills, pure references, simple command recipes, and reversible tasks where normal instructions are enough.
- Start with trigger, owner path, safety gate, and next safe action.
- Add TypeScript input contracts and facade-backed output contracts only when runtime parsing or output validation exists.

## Brainstorm To Agent-Native I/O

- Start from the idea, not the command shape.
- Grill one decision at a time.
- Record accepted decisions before implementation planning depends on them.
- Define two TypeScript-owned contracts:
  - input contract: package-owned intent envelope, parser, validation, defaults, and repair mapping
  - output contract: facade-owned runtime envelope plus package-owned `data`
- Keep output envelope shape aligned with the CLI command facade TypeScript contract.
- Put package-specific success, repair, and safety payloads inside the facade-owned output envelope.
- Use prose docs to describe intent, boundaries, and owner paths.
- Do not copy field catalogues into skill prose.
- Keep `SKILL.md` as entry-screen route clarity:
  - when to call the command
  - which owner path defines input
  - which owner path defines output
  - what safety gate applies
  - what next safe action follows
- Prove input parser acceptance, output envelope validation, rendered help, discovery metadata, and runtime semantics cannot drift.

## Example SKILL.md Shapes

- Read `references/skill-io-shape-examples.md` when choosing between artifact, simple operation, and runtime-backed capability `SKILL.md` shapes.
- Treat examples as shape guidance, not contracts.
- Treat the Heading Selection Matrix as heading guidance, not a required section schema.
- Keep exact field lists, command flags, output envelopes, and validation rules in the named owner paths.

## Evidence Loop

Use this when improving a skill after review, research, or a failed run.

1. Pick one skill and one task family.
2. Run a happy path.
3. Run adversarial probes: wrong trigger, bad owner path, missing input, invalid flag, stale state,
   ambiguous prompt.
4. Record observed failures only.
5. Patch the smallest sentence, command, or owner path that would have prevented the failure.
6. Validate frontmatter, examples, and owner commands.
7. Keep the patch only when it improves the observed task without bloating the skill.

Research anchor: [SkillOpt](https://microsoft.github.io/SkillOpt/).

## Skill Evolution

- Harden from observed failures first.
- Add gotchas only from observed failures.
- Patch descriptions when routing fails before adding workflow prose.
- Add the smallest gotcha, description edit, owner path, or example that would have prevented the miss.
- Escalate to scripts, checks, or telemetry only when repeated evidence earns machinery.
- Add telemetry only when usage measurement earns the carrying cost.
- Choose durable skill memory storage by owner, memory kind, mutability, privacy, and recovery need.
- Route storage placement with `skills/context-advisor/SKILL.md` when available.
- Use `skills/context-advisor/references/storage-routing.md` as the fallback owner reference when the advisor skill is unavailable.
- Use skill setup context only for user-specific or environment-specific context.
- Do not move generic workflow, deterministic contracts, or skill body rules into setup/config.

## Quality Checks

- Compare before/after on happy path and failure path.
- Prefer prune or substitute before adding instructions.
- Do not start repo-wide skill audits from philosophy changes alone; choose a scoped audit target or act from observed failure.
- During skill review or healing, check nearby skill bridges for expiry or removable old-name references.
- Move repeated planning into code, help, tests, or scripts.
- Declare tool permissions when risk matters: allowed tools, user-only, path-scoped, or model-only.
- Mark personal/local assumptions explicitly; avoid hidden user paths in reusable skills.
- Do not redefine agent persona or override higher-priority instructions.
- Omit install boilerplate, changelogs, licenses, TODOs, and generated filler from `SKILL.md`.

## Refusal Line

- Hypothetical hole: refuse or scope it out in prose.
- Real repeatable failure: patch from evidence.
- Prefer one-line guardrails, owner paths, or example updates before scripts or new structure.
- Treat adversarial review as a "do not build" list unless tests prove the failure matters.

## Composition

- Skills do not invoke other skills automatically.
- Compose through explicit handoff from a skill driver.
- The skill driver holds flow; callee does one job and hands back.
- Description is routing evidence, not guaranteed invocation.
- Use lifecycle hooks only when the runtime owns the event.

## State And Memory Skills

- Name the store in `## Owner` or `## Source`.
- Use `context-advisor` when the storage bucket is unclear and the skill is available.
- Read `skills/context-advisor/references/storage-routing.md` before choosing a durable memory store when `context-advisor` is unavailable.
- Add storage examples only after observed routing confusion; keep examples in the routing reference.
- Provide a refresh/status verb when the skill relies on mutable stored state.
- Do not invent persistence formats in prose.
- Record only future-useful state.

## Observability Additions

- Treat telemetry, append-only logs, persisted diagnostics, and session summaries as durable context until proven temporary.
- Add observability only when repeated evidence shows manual review, status, or repair is failing.
- Name the purpose: usage measurement, debugging, recovery, audit trail, or handoff.
- Name data class, privacy boundary, retention, deletion route, and review owner before writing.
- Use `context-advisor` when the owner store or privacy boundary is unclear.
- Keep success paths quiet unless the skill driver needs the signal.
- Prefer failure diagnostics and status commands before broad telemetry.
- Use allow-listed fields; reject or redact unknown fields.
- Never record raw prompts, raw message bodies, secrets, cookies, tokens, auth-bearing URLs, or private payload values.
- Add schema/check ownership when agents rely on logged fields.
- Add a repair path for corrupt, partial, stale, or privacy-invalid records.
- Do not add session summaries as a substitute for updating the owning tracker, decision log, context file, or runtime state.

## Safety Prose

- Express safety as model-readable fail-closed bullets.
- Treat community skill lists as discovery, not audit.
- Treat third-party skills as untrusted code: inspect `SKILL.md`, scripts, tool permissions, network use,
  owner paths, and prompt-injection patterns before install or reuse.
- Treat stdout/stderr as model-visible; never log secrets, tokens, cookies, or raw auth-bearing URLs.
- Shape-not-value for secrets: inspect presence, length, prefix, newline count; never print values.
- Redaction: allow-list what to keep; fail closed on unresolved secrets.
- Freshness: name source plus `doctor`, `status`, or `sync` command.
