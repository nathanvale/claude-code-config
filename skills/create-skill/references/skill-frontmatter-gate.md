# Skill Frontmatter Gate

Use when creating or changing skill frontmatter, trigger descriptions, routing, or invocation lane.

## Invocation Lane

- Choose `model lane` or `self invocation lane` before editing trigger text.
- `model lane`: description stays visible as a model context pointer. Use when automatic recall is valuable and false positives are low-cost.
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
- Add `when not` only when a nearby skill collision exists.
- Rename skills directly unless active route evidence proves a bridge is needed.
- Add a skill bridge only for live references in startup docs, active skills, scripts, plugin manifests, exported bundles, known external docs, or current user invocations.
- If an active-reference surface is inaccessible, add a dated temporary bridge with a removal condition instead of guessing.
- Name the bridge owner path, removal condition, checked surfaces, and evidence that requires it.

## Verification

- YAML-parse after frontmatter edits.
- Run description audit after description edits: `bun run skills/create-skill/scripts/skill-description-audit.ts --json`.
- Run startup check after startup route edits: `scripts/agent-instructions.sh check --json`.
