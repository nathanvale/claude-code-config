---
name: create-cli
description: "Design CLI UX/specs: basic CLI, agent-native CLI, or facade-backed CLI."
role: main-entry
---

# Create CLI

Design CLI surface area: syntax, behavior, help, output, errors, config,
safety, and validation depth.

## Do This First

- If there are no args, no command purpose, or only "make a CLI", ask the
  numbered router below; do not invent a spec.
- If the request is to create or edit a skill that wraps a CLI,
  `skills/skill-author/SKILL.md` owns the skill workflow; use this skill only
  for the CLI surface.
- Classify the lane:
  1. Basic CLI: humans first; scripts welcome; no advanced agent/runtime signal.
  2. Agent-native CLI: explicit agent-native, machine-readable, repairable,
     recoverable, autonomous-agent-facing, runtime-contract, or agents/scripts
     as primary users.
  3. Facade-backed CLI: explicit facade-backed, reusable facade code, facade
     runtime validation, or `@side-quest/cli-command-facade`.
  4. Not sure: ask the numbered router.
- Treat implementation language alone as ambiguous. Bun TypeScript does not
  imply Agent-native or Facade-backed.
- If intent is clear, route directly.
- If intent is ambiguous, ask which lane fits: humans only, agents/scripts too,
  reusable runtime validation, or not sure.
- After lane selection, read only the lane reference named below.

## Minimum CLI Design Brief

Capture this before lane-specific depth. Fill only fields that change behavior
for the selected lane:

- Command name and one-sentence purpose.
- Target users: humans, scripts, agents, or mixed.
- Invocation shape: command tree, args, flags, stdin/files/URLs.
- Help behavior: `-h/--help`, examples, discoverability.
- Output streams: primary data to stdout; diagnostics to stderr.
- Output modes: human text, `--json`, `--plain`, or other stable modes.
- Exit codes: baseline meanings; command-specific codes only when useful.
- Error style: invalid usage, runtime failure, recovery guidance.
- Side-effect stance: read, check, write, destructive, auth, network, browser.
- Safety gates: dry-run/check, confirmation, `--force`, `--no-input`.
- Config/env behavior: flags, env, config files, precedence.
- Non-interactive behavior: prompts, TTY assumptions, CI/agent path.
- Smoke command: smallest command proving the surface works.

## Lane Depth

- Basic CLI:
  - Read `references/cli-guidelines.md`; apply it as the default Basic CLI
    rubric.
  - Stay human-first and script-friendly.
  - Ask only the minimum questions needed.
  - Produce a compact CLI spec.
- Agent-native CLI:
  - Read `references/agent-native-cli-design.md`.
  - Apply the runtime-contract minimum in any language.
  - Add recipes only when risk or workflow value earns them.
  - Name behavior owners before implementation.
  - Add human handoff for destructive, auth, billing, externally visible, or
    irreversible actions.
- Facade-backed CLI:
  - Read `references/agent-native-cli-design.md`.
  - Read `references/cli-command-facade.md`.
  - Use the facade path only when explicitly requested or when the existing
    surface is facade-owned.
  - Name contract, model, engine, discovery, CLI, and test owners.
  - Include a Command Surface Alignment Proof.
  - Include all three test layers: unit tests, Branch Station catalog tests,
    and catalog-driven integration tests. See Testing Strategy in
    `references/cli-command-facade.md`.

## Next Safe Action

- Lane unclear → re-run the numbered router in Do This First.
- Basic or Agent-native implementation → prove help, parser acceptance,
  stdout/stderr separation, exit semantics, and the smoke command at the
  smallest useful level.
- Facade-backed → run the Command Surface Alignment Proof before shipping.
- Facade-backed → scaffold catalog-driven integration test alongside Branch
  Station catalog.
- Design complete → hand the filled Minimum CLI Design Brief and lane-specific
  proof path to the implementer.
- Skill edit → run `references/behavior-regression-checklist.md` before and after.

## Notes

- Prefer language-agnostic design unless the user asks for implementation.
- If the request is design-only, do not drift into implementation.
- Do not copy runtime schemas, generated envelopes, parser rules, facade field
  catalogues, or helper signatures into the answer; those are owned by
  `references/agent-native-cli-design.md` and `references/cli-command-facade.md` — name them.
- Before and after meaningful edits to this skill, run
  `references/behavior-regression-checklist.md` against the changed behavior.
