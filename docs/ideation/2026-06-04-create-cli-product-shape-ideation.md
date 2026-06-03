---
title: "create-cli product shape ideation"
date: 2026-06-04
status: draft
topic: "skills/create-cli"
---

# create-cli Product Shape Ideation

## Grounding

- Treat `create-cli` as a repo-local skill product.
- Preserve Pete's upstream CLI design coach as the default experience.
- Preserve the local agent-native extension from ADR 0009.
- Follow `context/skill-design-philosophy.md`: skill routes; owners hold contracts.
- Keep `SKILL.md` thin.
- Keep deterministic flags, schemas, output envelopes, validation rules, and helper signatures out of skill prose.
- Treat the later requirements brainstorm as a refinement: agent-native is a design standard; facade is an optional backend.
- Use evidence from scratch runs:
  - Pete upstream: shell CLI and Bun TypeScript CLI both produce normal language-agnostic CLIs.
  - Pre-rewrite local skill: shell CLI stays normal; Bun TypeScript prompt routes into facade-backed contract work.
  - Current rewrite: shell CLI stays normal; Bun TypeScript loses facade-backed path.

## External Anchors

- CLIG remains the right human-first CLI baseline: discoverable help, examples, next commands, and clear errors.
- SkillOpt supports bounded skill edits from observed runs, not speculative instruction bloat.

## Surviving Ideas

### 1. Front Door: Basic Coach Plus Agent-Native Builder

- Make the default lane Pete-shaped.
- Make the advanced mode local and agent-native.
- Keep agent-native language-agnostic.
- Treat facade as an optional backend, not the definition of advanced mode.
- Route by intent, not by prose volume.
- Keep both lanes inside one workflow.
- Avoid a parallel `agent-cli` skill.

Why it survives:

- Matches ADR 0009.
- Preserves the product value found in pre-rewrite behavior.
- Keeps the cognitive model simple: normal CLI first; agent-native when needed.
- Allows agent-native CLI design in shell, Python, Ruby, Go, Bun, and other languages.
- Avoids hiding the facade path in a reference nobody reads.

Risk:

- The lane boundary can become fuzzy.

Mitigation:

- Add a tiny trigger list.
- Keep exact contract details in owner paths.

### 2. Mode And Backend Trigger Matrix

- Trigger agent-native mode when the user asks for agent-native, machine-readable, parseable, repairable, discovery-ready, MCP-wrapped, or autonomous-agent-facing CLIs.
- Trigger facade-backed mode when the user asks for reusable facade code, runtime validation, facade-backed implementation, `@side-quest/cli-command-facade`, or an existing facade-owned repo surface.
- Treat repo CLI/runtime work as advanced by default when it touches existing facade-owned surfaces.
- Treat "Bun TypeScript CLI" as an offer point, not an automatic hard trigger.

Why it survives:

- Restores the missing local behavior without making every TypeScript CLI heavy.
- Reduces user surprise.
- Lets power users ask for a basic Bun CLI and get one.
- Lets power users apply agent-native design without adopting the facade runtime.

Risk:

- Agents may under-route advanced mode for terse prompts.

Mitigation:

- Add one example pair:
  - "basic shell CLI" routes default.
  - "agent-native Bun TypeScript CLI" routes advanced.
  - "facade-backed Bun TypeScript CLI" routes advanced plus facade backend.

### 3. Facade Contract Path As Owner Map, Not Template Catalog

- Keep `references/cli-command-facade.md` as the path to implementation.
- Name contract, help, parser, runtime, and tests before coding.
- Point to facade source and generated help for exact fields and helper signatures.
- Remove copied contract skeletons unless they are illustrative and clearly non-authoritative.

Why it survives:

- Fits skill philosophy.
- Keeps the advanced path real.
- Avoids contract drift.

Risk:

- Too little guidance may cause agents to skip the runtime.

Mitigation:

- Require running the contract module as the advanced-mode verification step.

### 4. Behavior-Regression Harness For The Skill

- Keep a small scratch prompt set:
  - basic shell CLI
  - basic Bun TypeScript CLI
  - agent-native Bun TypeScript CLI
  - existing repo facade-backed command change
- Compare outputs before skill changes.
- Keep only edits that improve observed behavior.

Why it survives:

- Directly follows the evidence loop.
- Catches the exact regression we saw.
- Gives future reviews something concrete.

Risk:

- Manual runs are subjective.

Mitigation:

- Check for structural markers:
  - default lane has compact CLI spec and smoke command.
  - advanced lane names owners, contract module, parser/help/runtime alignment, and runtime validation.

### 5. Product Name: "CLI Design Coach With Advanced Agent-Native Mode"

- Use this phrase in discussion and provenance.
- Do not put marketing language in `SKILL.md`.
- Let `SKILL.md` show behavior through workflow bullets.

Why it survives:

- Names the product shape without bloating the skill.
- Keeps Nathan's intended mental model visible.
- Makes the distinction easier to explain to future agents.

Risk:

- Name could become another concept to maintain.

Mitigation:

- Keep it in provenance or ideation docs, not runtime-facing instructions.

## Rejected Ideas

### Pete-Only Shape

- Rejected because it loses the local advanced path.
- Rejected because current scratch runs show Bun TypeScript regressed to plain CLI output.
- Keep Pete as the default lane, not the whole product.

### Facade-First Shape

- Rejected because it overfits to side-quest-engineering.
- Rejected because many users only need a shell CLI or simple language-specific CLI.
- Keep facade as advanced mode, not default identity.

### Bun TypeScript Always Means Facade

- Rejected because users can reasonably ask for a basic Bun CLI.
- Rejected because language choice is not the same as agent-native intent.
- Use Bun TypeScript as a prompt to consider advanced mode.

### Separate Agent-Native CLI Skill

- Rejected by ADR 0009.
- Rejected because it creates parallel policy for one workflow.
- Keep one skill with two lanes.

### Copy Contract Details Into `SKILL.md`

- Rejected by `context/skill-design-philosophy.md`.
- Rejected because code, generated help, and runtime tests own deterministic behavior.
- Point to owner paths instead.

## Recommended Shape

- Land on one skill with three concepts:
  - Minimum CLI contract: applies to every path.
  - Basic CLI design coach: default.
  - Agent-native CLI builder: advanced design standard, any language.
  - Facade runtime path: optional backend.
- Use agent-native mode for explicit agent-native intent.
- Use facade-backed mode only for explicit facade intent or existing facade-owned repo surfaces.
- Offer advanced mode for Bun TypeScript when the prompt is ambiguous.
- Keep implementation details in references and owner code.
- Add a lightweight behavior-regression prompt set before changing the skill again.

## Follow-Up Concern

- Keep "validated" language precise.
- Validation can mean design-level alignment in any language.
- Facade-backed runtime validation requires explicit facade intent.
- Avoid letting "validated CLI" silently collapse into the facade path.

## Planning Target

- Define the exact router wording.
- Decide where the minimum CLI contract checklist lives.
- Decide the smallest `SKILL.md` wording that restores agent-native routing.
- Decide where the manual behavior-regression checklist lives.
