# Skill Design Philosophy

Default model for authoring, reviewing, healing, and repairing `SKILL.md` files in this repo.

## Core Rule

- Contracts where a machine parses.
- Prose where a model reasons.
- Skill bodies route the model: when to act, what to run, what to read, when to stop.
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
- Add `references/` only when depth would bloat `SKILL.md`.
- Avoid `scripts/` plus `references/` plus extra machinery unless the skill is genuinely large.

## Frontmatter

- Use `name` plus quoted `description`.
- Write `description` as trigger phrase, not summary.
- Exclude personal names unless routing requires them.
- YAML-parse after edits.

## Body

- Write terse prose plus commands.
- Write triggers, not essays.
- Give the next safe action.
- Prefer examples over abstract explanation.
- Keep one workflow per skill.
- Use references for depth, one level down.
- Delete prose that does not change behavior.

## Owner Paths

- Name the owner path instead of copying the contract.
- Runtime-backed skill docs name commands and env vars for routing only.
- Code/help/tests own flags, schemas, state machines, validation rules, and output semantics.
- Use headings like `## Owner`, `## Commands`, `## Verification`, `## Safety`, `## Known Pitfalls`.
- Use `## Contract` only to point at the authoritative owner path.

## Evidence Loop

Use this when improving a skill after review, research, or a failed run.

1. Pick one skill and one task family.
2. Run a happy path.
3. Run adversarial probes: wrong trigger, bad owner path, missing input, invalid flag, stale state,
   ambiguous prompt.
4. Record observed failures only.
5. Patch the smallest sentence, command, or owner pointer that would have prevented the failure.
6. Validate frontmatter, examples, and owner commands.
7. Keep the patch only when it improves the observed task without bloating the skill.

Research anchor: [SkillOpt](https://microsoft.github.io/SkillOpt/).

## Quality Checks

- Compare before/after on happy path and failure path.
- Prefer prune or substitute before adding instructions.
- Move repeated planning into code, help, tests, or scripts.
- Choose invocation mode deliberately: auto, user-only, model-only, or path-scoped.
- Declare tool permissions when risk matters: allowed tools, user-only, path-scoped, or model-only.
- Mark personal/local assumptions explicitly; avoid hidden user paths in reusable skills.
- Do not redefine agent persona or override higher-priority instructions.
- Omit install boilerplate, changelogs, licenses, TODOs, and generated filler from `SKILL.md`.

## Refusal Line

- Hypothetical hole: refuse or scope it out in prose.
- Real repeatable failure: patch from evidence.
- Prefer one-line guardrails, owner pointers, or example updates before scripts or new structure.
- Treat adversarial review as a "do not build" list unless tests prove the failure matters.

## Composition

- Skills do not auto-fire each other.
- Compose through explicit handoff from a driver skill.
- Driver holds flow; callee does one job and hands back.
- Description is discovery, not guaranteed routing.
- Use lifecycle hooks only when the runtime owns the event.

## State And Memory Skills

- Name the store in `## Owner` or `## Source`.
- Provide a refresh/status verb.
- Do not invent persistence formats in prose.
- Record only future-useful state.

## Safety Prose

- Express safety as model-readable fail-closed bullets.
- Treat third-party skills as untrusted code: inspect `SKILL.md`, scripts, tool permissions, network use,
  and prompt-injection patterns before install.
- Treat stdout/stderr as model-visible; never log secrets, tokens, cookies, or raw auth-bearing URLs.
- Shape-not-value for secrets: inspect presence, length, prefix, newline count; never print values.
- Redaction: allow-list what to keep; fail closed on unresolved secrets.
- Freshness: name source plus `doctor`, `status`, or `sync` command.
