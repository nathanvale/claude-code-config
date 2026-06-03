# Behavior Regression Checklist

Use before and after meaningful edits to `create-cli`.

## Method

- Run each prompt as a scratch skill invocation.
- Record route, structural markers, and drift.
- Check structure, not exact prose.
- Keep the edit only when routing improves without bloating `SKILL.md`.
- Reject copied schemas, generated envelopes, parser rules, facade field
  catalogues, and helper signatures.

## Prompt Set

### Basic Shell CLI

- **Prompt:** `Design a shell CLI for archiving old log files.`
- **Expected route:** Basic CLI.
- **Expected markers:**
  - Uses Minimum CLI design brief.
  - Produces human-first CLI spec.
  - Includes usage, flags, stdout/stderr, errors, safety, examples.
  - Avoids agent-native runtime ceremony.
  - Avoids facade-backed implementation guidance.
- **Observed route:**
  Basic CLI.
- **Observed markers:**
  Minimum CLI design brief, compact CLI spec, stdout/stderr, errors, safety,
  examples.
- **Notes:**
  Static route check from `SKILL.md`; no facade marker present.

### Ambiguous Bun TypeScript CLI

- **Prompt:** `Create a Bun TypeScript CLI for checking project health.`
- **Expected route:** Ambiguous; offer numbered router.
- **Expected markers:**
  - Does not choose Facade-backed only because Bun TypeScript appears.
  - Offers Basic CLI, Agent-native CLI, Facade-backed CLI, and Not sure.
  - Frames choice by user need: humans, agents/scripts, or runtime validation.
- **Observed route:**
  Ambiguous; numbered router.
- **Observed markers:**
  Basic CLI, Agent-native CLI, Facade-backed CLI, Not sure; Bun TypeScript is
  not treated as a facade trigger.
- **Notes:**
  Static route check from `SKILL.md`.

### Agent-Native Python CLI

- **Prompt:** `Design an agent-native Python CLI that agents can run, parse, recover from, and validate.`
- **Expected route:** Agent-native CLI.
- **Expected markers:**
  - Uses Minimum CLI design brief.
  - Applies runtime-contract minimum.
  - Adds recipes by risk and workflow value.
  - Names behavior owners before implementation.
  - Does not require the facade path.
- **Observed route:**
  Agent-native CLI.
- **Observed markers:**
  Minimum CLI design brief, runtime-contract minimum, risk-selected recipes,
  owner naming, no facade requirement.
- **Notes:**
  Static route check from `SKILL.md` and `agent-native-cli-design.md`.

### Facade-Backed Bun TypeScript CLI

- **Prompt:** `Create a facade-backed Bun TypeScript CLI using @side-quest/cli-command-facade.`
- **Expected route:** Facade-backed CLI.
- **Expected markers:**
  - Applies Agent-native CLI first.
  - Follows `references/cli-command-facade.md`.
  - Names contract, model, engine, discovery, CLI, and test owners.
  - Includes validation loop and Command Surface Alignment Proof.
  - Points to owner paths for exact contract shape.
- **Observed route:**
  Facade-backed CLI.
- **Observed markers:**
  Agent-native first, facade path map, owner paths, validation loop, Command
  Surface Alignment Proof.
- **Notes:**
  Static route check from `SKILL.md` and `cli-command-facade.md`.

## Acceptance Gate

- Basic prompt still produces a compact human-first design.
- Ambiguous Bun TypeScript prompt asks or offers before choosing depth.
- Agent-native non-TypeScript prompt stays language-agnostic.
- Facade-backed prompt follows facade path only when explicitly requested.
- References point to owner paths for deterministic contract shape.
- `SKILL.md` stays route-oriented.
