# Behavior Regression Checklist

Use before and after meaningful edits to `create-cli`.

## Method

- Run each prompt as a scratch skill invocation.
- Record fresh route, structural markers, and drift for the current edit.
- Treat committed observations as stale by default.
- Check structure, not exact prose.
- Keep the edit only when routing improves without bloating `SKILL.md`.
- Reject copied schemas, generated envelopes, parser rules, facade field
  catalogues, and helper signatures.
- Use this result shape per prompt:
  - Route:
  - Markers:
  - Drift:

## Prompt Set

### No Args / Ambiguous CLI

- **Prompt:** invoke `create-cli` with no args, or `make a CLI`.
- **Expected route:** Ambiguous; offer the numbered router.
- **Expected markers:**
  - Does not invent a full spec.
  - Does not read lane references before lane selection.
  - Offers Basic CLI, Agent-native CLI, Facade-backed CLI, and Not sure.

### Basic Shell CLI

- **Prompt:** `Design a shell CLI for archiving old log files.`
- **Expected route:** Basic CLI.
- **Expected markers:**
  - Uses Minimum CLI design brief.
  - Produces human-first CLI spec.
  - Includes usage, flags, stdout/stderr, errors, safety, examples.
  - Avoids agent-native runtime ceremony.
  - Avoids facade-backed implementation guidance.

### Ambiguous Bun TypeScript CLI

- **Prompt:** `Create a Bun TypeScript CLI for checking project health.`
- **Expected route:** Ambiguous; offer numbered router.
- **Expected markers:**
  - Does not choose Basic only because Bun TypeScript and a purpose appear.
  - Does not choose Facade-backed only because Bun TypeScript appears.
  - Offers Basic CLI, Agent-native CLI, Facade-backed CLI, and Not sure.
  - Frames choice by user need: humans, agents/scripts, or runtime validation.

### Agent-Native Python CLI

- **Prompt:** `Design an agent-native Python CLI that agents can run, parse, recover from, and validate.`
- **Expected route:** Agent-native CLI.
- **Expected markers:**
  - Uses Minimum CLI design brief.
  - Applies runtime-contract minimum.
  - Adds recipes by risk and workflow value.
  - Names behavior owners before implementation.
  - Names help, parser, stdout/stderr, exit, and smoke proof.
  - Does not require the facade path.

### Agent-Native Multi-Command CLI

- **Prompt:** `Design an agent-native CLI with ready, claim, note, and done commands.`
- **Expected route:** Agent-native CLI.
- **Expected markers:**
  - Names behavior owners before implementation.
  - Keeps the CLI dispatcher thin.
  - Puts command bodies in named handlers after lookup, validation, network,
    file, or mutation behavior appears.
  - Extracts repeated target parsing, validation, envelope builders, and
    tool-call error builders before the third copy appears.
  - Runs Fallow after meaningful CLI implementation.
  - Treats private-handler `add-tests` findings as coverage prompts, not
    automatic direct-test requirements.

### Facade-Backed Bun TypeScript CLI

- **Prompt:** `Create a facade-backed Bun TypeScript CLI using @side-quest/cli-command-facade.`
- **Expected route:** Facade-backed CLI.
- **Expected markers:**
  - Applies Agent-native CLI first.
  - Follows `references/cli-command-facade.md`.
  - Names contract, model, engine, discovery, CLI, and test owners.
  - Includes validation loop and Command Surface Alignment Proof.
  - Points to owner paths for exact contract shape.
  - Keeps result metadata attachment on the facade result-data helper path.
  - Keeps structured runtime errors on facade helper constructors.
  - Avoids `Record<string, unknown>` as the default for interface-shaped result
    payloads.
  - Includes all three test layers: unit tests, Branch Station catalog tests,
    and catalog-driven integration tests.

### Skill Edit

- **Prompt:** `Update create-cli routing.`
- **Expected route:** Skill edit.
- **Expected markers:**
  - Routes before the no-args / no-command-purpose guard.
  - Runs this checklist before and after meaningful edits.
  - Patches only behavior that improves routing, structure, steering, or pruning.
  - Does not add copied contracts to `SKILL.md`.

### Skill-Author Overlap

- **Prompt:** `create a skill that wraps a CLI with JSON output and durable writes.`
- **Expected route:** `skill-author` owns skill creation; `create-cli` owns only
  the CLI surface.
- **Expected markers:**
  - Keeps skill frontmatter/body/safety gates with `skills/skill-author/SKILL.md`.
  - Uses `create-cli` only after the CLI surface is selected.
  - Does not duplicate the skill-author workflow.

## Acceptance Gate

- Basic prompt still produces a compact human-first design.
- No-args prompt asks or offers before spec creation.
- Ambiguous Bun TypeScript prompt asks or offers before choosing depth.
- Agent-native non-TypeScript prompt stays language-agnostic.
- Multi-command agent-native prompt preserves implementation-shape guidance.
- Facade-backed prompt follows facade path only when explicitly requested.
- Skill-author overlap prompt keeps skill creation owned by `skill-author`.
- References point to owner paths for deterministic contract shape.
- Facade-backed prompt preserves result-data helper and structured-error helper
  guardrails without copying helper signatures.
- Facade-backed prompt includes three test layers (unit, catalog, integration).
- `SKILL.md` stays route-oriented.
