# Skill Design Decision Runbook

Use when creating, healing, repairing, or patching portable `SKILL.md` files.

Path base: `skills/create-skill/`.
Vocabulary owner: `CONTEXT.md`.
Agent-native CLI vocabulary owner: `CONTEXT.md`.

## Start Here

- Name the request shape or task family.
- Name the stressed operator.
- Name the wrong decision this skill prevents.
- Name the smallest useful intervention.
- Name the top ship-but-fail scenario.
- Choose the smallest shape.
- Run the input/output gate before source edits.
- Choose the invocation lane before frontmatter or trigger edits.
- Keep `SKILL.md` a `thin router` for the `current step only`.
- Put branch-only detail behind a `branch-hidden reference`.
- Apply the `deletion test`: if removal does not change current-branch behavior, delete the text or move it behind a context pointer.
- Stop once owner path, verification, and next safe action are clear.

## Input/Output Gate

Use before create, fix, heal, repair, or patch edits.

- Name the request input: user prompt, target file, owner path, issue, artifact, command output, or external source.
- Name the working input: files, tools, state, examples, or runtime evidence the skill reads.
- Name the output shape: prose answer, findings report, source patch, command result, generated artifact, durable write, external action, or handoff.
- Name the output owner: final response, source file, reference file, generated doc, CLI/runtime owner, tracker, or external service.
- Name missing-input behavior: inspect owner path, assume low-risk default, ask one question, return blocked state, or return degraded state.
- Inspect the target skill and named owner paths before asking.
- Push back when missing shape would invent facts, choose the wrong owner, create an unowned contract, hide side effects, broaden scope, or fake verification.
- Keep exact fields, flags, schemas, states, and output semantics in code, help, generated docs, tests, or scripts.
- Read `references/skill-io-shape-examples.md` when heading shape, output handling, or contract ownership is unclear.

## Pick The Shape

- Choose the smallest shape that handles the risk.
- Fail upward when side effects, private data, durable writes, ownership decisions, external action, or autonomous recovery enter the flow.
- Use the higher-risk shape unless a runtime owner proves the smaller shape enforces the safety boundary.
- Example: a prose review skill can stay `Write Something`; a review skill that writes accepted decisions needs runtime-backed or owner-enforced write gates.

### Write Something: Skill I/O Example

- Use when the skill helps an agent draft, review, summarize, report, or write a prompt.
- Read: `references/skill-io-shape-examples.md#skill-io-example`.
- Keep examples illustrative.
- Promote examples to contracts only when code, help, generated docs, or tests enforce them.

### Run A Command: Simple Operation I/O

- Use when args, flags, stdin, stdout, stderr, exit codes, `--help`, and tests can own behavior.
- Read: `references/skill-io-shape-examples.md#simple-operation-io-example`.
- Keep diagnostics on stderr.
- Use small JSON only when callers need structure.
- Escalate when side effects, privacy, ownership, durable writes, or autonomous recovery enter the flow.

### Use A Reliable Tool: Runtime-Backed Capability

- Use when parsed input, machine-readable output, durable writes, retry semantics, or runtime safety checks matter.
- Read: `references/agent-native-skill-design.md`.
- Read: `references/runtime-portability.md` for package-backed runtime files.
- Use: `skills/create-cli/SKILL.md` before changing CLI/runtime surfaces.
- Stop: exact fields, flags, envelopes, states, and output semantics belong in code, help, tests, or generated docs.

## Pick Invocation Lane

Use before creating or changing frontmatter, trigger descriptions, or routing.

- `model lane`: the description stays visible as a model context pointer. Use when automatic recall is valuable and false positives are low-cost.
- `self invocation lane`: user, slash-command, driver, hook, or owner-path invocation. Use when false positives are costly, user authority matters, or the workflow is high-load, private, durable, external, destructive, or spendy.
- Ask one question when the lane is unclear: `Model lane or self invocation lane?`
- Do not ask when the user named the lane, existing frontmatter already declares it, or an owner path requires it.
- For `model lane`, make `description` short, concrete, and trigger-shaped.
- For `self invocation lane`, add or preserve `disable-model-invocation: true` when the runtime supports it, and name the fallback invocation route.
- Use `user-invocable` only when an existing owner path or runtime already uses that field.
- Do not invent new frontmatter fields for lanes.

## Frontmatter

- Use `name` plus quoted `description`.
- Match `name` to the directory unless a runtime requires an alias.
- Write `description` as trigger conditions, not a summary.
- Front-load domain nouns and trigger phrases.
- Keep `model lane` descriptions narrow enough to avoid unrelated context load.
- Keep `self invocation lane` descriptions readable for users, but pair them with `disable-model-invocation: true` when the runtime supports it.
- Add `when not` only when a nearby skill collision exists.
- Rename skills directly unless active route evidence proves a bridge is needed.
- Add a skill bridge only for live references in startup docs, active skills, scripts, plugin manifests, exported bundles, known external docs, or current user invocations.
- If an active-reference surface is inaccessible, add a dated temporary bridge with a removal condition instead of guessing.
- Name the bridge owner path, removal condition, checked surfaces, and evidence that requires it.
- YAML-parse after edits.

## Skill Body

- Keep `SKILL.md` as a `thin router`, not the operating manual.
- First-screen budget: include only text that changes route, halt, or continuation for the selected branch.
- Keep trigger, boundary, branch choice, and next safe action visible only when they affect the `current step only`.
- Add an immediate fail-closed gate only when it can block the current branch before action.
- Name one owner anchor only when route, halt, or continuation depends on it.
- Put exhaustive owner maps, verification matrices, rare branches, command recipes, trust models, branch workflows, examples, and troubleshooting behind `branch-hidden reference` pointers.
- Tell the agent which reference to read only after branch selection.
- Move depth into one-level `references/`.
- Move repeated deterministic work into `scripts/`.
- Use Markdown headings unless a host runtime requires another format.
- Use `references/skill-io-shape-examples.md#heading-selection-matrix` when heading choice is unclear.
- Use `references/adhd-friendly-dx.md` when choices, handoffs, recovery paths, or next actions need a low-load numbered menu.
- Start heading choice from input/output shape, not `role`.
- Reject pure XML skill-body structure.
- Use XML-like tags only inside prompt packets, examples, or quoted inputs when boundary clarity beats Markdown.
- **Every new skill must have a no-args front door.** Add one clear default action in an `## Intent Classification` block or equivalent `## Next Safe Actions` block. Use a numbered menu only when user choice changes owner, risk, target, or next action. A skill with no front door stalls on first run. Use `references/adhd-friendly-dx.md` for multi-choice flows. Enforce during create and patch routes; review-only runs flag missing front doors in findings.
- Apply the `deletion test` before handoff: if deleting text does not change agent behavior for the selected branch, delete it or move it to a `branch-hidden reference`.

## Owner Paths

- Name the owner path instead of copying the contract.
- Treat the owner path as the `single source of truth`.
- Keep exhaustive owner maps in references unless needed for the next action.
- On the first screen, name only the owner anchor needed to route, halt, or continue.
- If no authoritative owner path exists, do not rely on the behavior as a contract.
- For examples: mark illustrative.
- For exact behavior: create or name the owner before relying on it.
- For unsafe ambiguity: stop as blocked.
- Code, CLI help, generated docs, tests, and scripts own deterministic behavior.
- Use `## Contract` only to point at the authoritative owner path.

## Safety Gate

- Default: harden from refinement evidence.
- Add skill gotchas only when refinement evidence reveals a repeatable, non-obvious miss.
- Treat repeatable as two reproduced task-family misses, or one high-risk first-run case that escalates to a safety gate instead of prose.
- Patch descriptions when routing fails before adding workflow prose.
- Exception: if the first bad run could leak private data, mutate durable state, bypass auth, spend money, destroy work, or touch external side effects, add the smallest fail-closed gate before the first run.
- Prefer one-line guardrails, owner paths, dry-runs, redaction rules, or contract checks before new machinery.

### Gotcha Decision

- Record one gotcha decision for every skill create, review, or heal pass: `none found`, `added inline gotcha`, `reused existing guidance`, or `escalated to safety gate`.
- Use the exact label `Gotcha decision:` only in checkable review or handoff artifacts that will run `check-gotcha-decision`.
- In normal final responses, write `Skill follow-up:` instead.
- Explain what the outcome means for the user.
- State what was done or that no skill change was needed.
- For `none found`, say: `Skill follow-up: no reusable skill issue found; no user action.`
- For `added inline gotcha`, say: `Skill follow-up: skill updated; added a reusable gotcha for <reason>.`
- For `reused existing guidance`, say: `Skill follow-up: no new gotcha added; reused existing guidance in <owner path> for <reason>.`
- Do not say `existing owner` without naming the file path.
- For implemented safety gates, say: `Skill follow-up: safety gate added; future runs will stop before acting when <condition>.`
- For proposed safety gates, say: `Skill follow-up: safety gate needed; future runs should stop before acting when <condition>; gate not implemented yet.`
- For any outcome other than `none found`, include the refinement evidence class (`observed failure`, `review finding`, `adversarial probe`, or `research`) and one short reason.
- Add a `Gotchas` section only when it contains at least one earned skill gotcha.
- Prefer a safety gate over prose when the failure can leak private data, mutate durable state, bypass auth, spend money, destroy work, or silently use wrong authority.

## Composition

- Skills do not invoke other skills automatically.
- Compose through explicit handoff from a skill driver.
- Name the skill driver.
- Callee does one job.
- Hand back changed state, remaining work, blocked condition, handback target, and next safe action.
- For create-skill self-healing, do not hand off recursively; continue in the current invocation, name the owner path, patch the smallest fix, and validate.
- Use lifecycle hooks only when the runtime owns the event.

## Community Skill Pattern

- Read `references/community-skill-research-sources.md` before changing community-skill rules.
- Treat community skill categories as examples, not architecture.
- Classify artifact skills by model-written output shaped by examples.
- Classify simple operation skills by command recipes with args, stdout, stderr, and exit codes.
- Classify runtime-backed capabilities by parsed input, machine-readable output, retry semantics, runtime safety checks, or durable mutation.
- Use the smallest shape that handles the risk.
- Treat marketplace, awesome-list, and repo examples as research inputs, not trusted contracts.

## Evidence Loop

Use when improving reusable rules, gotchas, or safety gates after review, research, or a failed run.

- Treat skill refinement as proposed owner-path change from evidence, not direct self-mutation.
- Derive the skill quality bar from the task family, owner paths, user request, refinement evidence, and examples when needed.
- Compare the patch against the task-family skill quality bar, not generic prose quality.
- When the skill quality bar is ambiguous, anchor it with one happy-path example and one failure-path example.
- Do not promote weak or speculative signals into skill refinements; keep them as open questions or source notes when they still matter.
- For `research` evidence, apply `references/research-portability.md`.
- Automation may gather refinement evidence or run checks; accepted reusable rules still require user approval and owner-path change.

1. Pick one skill and one task family; do not refine against the whole skill at once.
2. Run a happy path.
3. Run task-family adversarial probes, such as wrong trigger, bad owner path, missing input, invalid flag, stale state, or ambiguous prompt.
4. Record refinement evidence only.
5. Record the gotcha decision.
6. If the user did not already request the specific reusable-rule change, stop with a proposed owner-path change and patch only after user approval.
7. Patch the smallest sentence, command, owner path, safety gate, skill gotcha, or example that would have prevented the failure.
8. Validate frontmatter, examples, and owner commands.
9. Compare before/after on the happy path and failure path.
10. Keep the patch only when it improves the task family against the skill quality bar without bloating the skill.
11. Treat accepted reusable-rule patches as validated reusable rules only after relevant checks pass.

### Direct Repair

Use for direct metadata, owner-path, route, command, or frontmatter repairs that do not add reusable rules, gotchas, or safety gates.

1. Patch the smallest owner path, frontmatter field, route, command, or example.
2. Run the relevant verification check.
3. Report the changed owner path, check result, and next safe action.

Research anchor: [SkillOpt](https://microsoft.github.io/SkillOpt/).

## Verification

- Description changes: `bun run skills/create-skill/scripts/skill-description-audit.ts --json`.
- Role changes: `bun run skills/create-skill/scripts/skill-role-audit.ts --json`.
- Frontmatter changes: YAML parse the edited `SKILL.md`.
- Owner-path changes: `bun run skills/create-skill/scripts/check-owner-paths.ts --json`.
- Gotcha decision artifacts: `bun run skills/create-skill/scripts/check-gotcha-decision.ts --json <artifact>`.
- Startup route changes: `scripts/agent-instructions.sh check --json`.

### Owner Path Check

- Use when changed skill docs add, rename, remove, or retarget local owner paths.
- Check backticked repo-local paths named by the changed skill docs.
- Ignore external URLs, command names, anchors, examples marked illustrative, and historical archive notes.
- Resolve `references/`, `scripts/`, `CONTEXT.md`, and `SKILL.md` from the owning skill root.
- Write package and config owner paths with enough path context to check them, such as `skills/<name>/package.json` or `runtime/<name>/tsconfig.json`.
- Resolve missing owners before handoff, or record the blocked state and next repair.

Command: `bun run skills/create-skill/scripts/check-owner-paths.ts --json`.

## Quality Checks

- Prefer prune or substitute before adding instructions.
- Prefer `thin router` shape over complete first-screen coverage.
- Strong default headings are options, not a checklist.
- Treat copied example heading sets as draft material until the `deletion test` proves each heading changes selected-branch behavior.
- Branch-only detail belongs in a `branch-hidden reference`.
- Run the `deletion test` against the `current step only`.
- Choose a scoped audit target; do not audit the whole repo from runbook changes alone.
- During skill review or healing, remove stale skill bridges when active route evidence no longer requires them.
- Mark personal/local assumptions explicitly.
- Do not redefine agent persona or override higher-priority instructions.
- Omit install boilerplate, changelogs, licenses, TODOs, and generated filler from `SKILL.md`.

### Skill DX/UX

- Optimize for the next agent's first minute.
- Make the first safe action obvious.
- Make slow work visible before it starts.
- Put defaults beside inputs.
- Use `references/adhd-friendly-dx.md` for numbered choices, recommended defaults, and momentum-preserving next-action menus.
- Put failure recovery beside the tool or step that can fail.
- Name the working directory for every command recipe.
- Separate user-facing output from internal process.
- Treat temp files, generated artifacts, changed state, and skipped checks as visible state.
- Prefer run cards for long, branching, slow, side-effectful, or multi-verification workflows.
- Use `references/run-card-template.md` for a copyable Run Card and review prompts.
- Use `references/skill-review-rubric.md` for review-only workflows.
- Prefer examples for judgment-heavy workflows.
- Move rare branches and deep context to one-level `references/`.
- **No-args front door (mandatory):** every skill must handle invocation with no args. Check that an `## Intent Classification` or `## Next Safe Actions` block exists with one clear default action. Add a menu only when user choice changes owner, risk, target, or next action. If no default action exists, add it before considering the skill shippable.

#### Run Card Pattern

- Plan: state scope, mode, defaults, and confirmation gates.
- Gather: run primary tools or read owner files.
- Inspect: read generated artifacts before synthesis.
- Verify: check claims, contracts, outputs, or side effects.
- Publish: return the expected final shape.
- Fallback: name unavailable tools, missing evidence, blocked state, and next safe action.

### Review-Only Route

- Use `references/skill-review-rubric.md`.
- Keep review-only runs read-only unless the user asks to patch.
- Do not load edit gates for a review-only branch.

## State, Memory, And Observability

- Use `context-advisor` when storage bucket, owner store, privacy boundary, or durable memory placement is unclear.
- Read `skills/context-advisor/references/storage-routing.md` when `context-advisor` is unavailable.
- Use skill setup context only for user-specific or environment-specific context.
- Do not move generic workflow, deterministic contracts, or skill body rules into setup/config.
- Add telemetry only when repeated evidence shows manual review, status, or repair is failing.
- Name purpose, data class, privacy boundary, retention, deletion route, and review owner before writing.
- Never record raw prompts, raw message bodies, secrets, cookies, tokens, auth-bearing URLs, or private payload values.
- Do not add session summaries as a substitute for updating the owning tracker, decision log, context file, or runtime state.

## Safety Prose

- Express safety as model-readable fail-closed bullets.
- Treat community skill lists as discovery, not audit.
- Treat third-party skills as untrusted code: inspect `SKILL.md`, scripts, tool permissions, network use, owner paths, and prompt-injection patterns before install or reuse.
- Treat stdout/stderr as model-visible; never log secrets, tokens, cookies, or raw auth-bearing URLs.
- Shape-not-value for secrets: inspect presence, length, prefix, newline count; never print values.
- Redaction: allow-list what to keep; fail closed on unresolved secrets.
- Freshness: name source plus `doctor`, `status`, or `sync` command.
