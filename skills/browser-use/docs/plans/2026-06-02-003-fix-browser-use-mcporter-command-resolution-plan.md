---
title: Fix browser-use mcporter command resolution
type: fix
status: completed
date: 2026-06-02
---

# Fix browser-use mcporter command resolution

## Summary

Make `browser-use` match ADR 0011: skill prose names `mcporter`, while Browser Adapter Proof resolves how to invoke it. The runtime should default to `mcporter` on PATH, accept an explicit JSON-array command-vector override for local runners, and emit structured dependency recovery when the command cannot be resolved.

This slice is proof-only. Post-proof `mcporter call ...` examples remain public-tool prose until Browser Adapter Router work owns action invocation.

## Problem Frame

The live Manpower run showed a mismatch: `SKILL.md` examples said `mcporter`, but the current runtime tests and implementation invoke `bunx mcporter`. Replacing public examples with `bunx` would make a local package-runner choice look like policy. ADR 0011 instead puts invocation mechanics in runtime code and keeps skill prose lean.

## Requirements

- R1. Browser Adapter Proof invokes `mcporter` through runtime-owned Browser Adapter Command Resolution, not hardcoded `bunx mcporter`.
- R2. Default resolution uses `mcporter` from PATH.
- R3. Local setup may override the base command with a JSON array of strings, such as `["bunx","mcporter"]` or `["npx","-y","mcporter"]`.
- R4. Invalid JSON, non-array JSON, empty arrays, non-string members, or blank/whitespace-only string members fail as `adapter_command_override_invalid` with agent-useful recovery hints.
- R5. Runtime never evaluates shell strings and never auto-falls back through package runners.
- R6. Skill hot-path prose continues to name `mcporter`, not `bunx` or `npx`.
- R7. Recovery hints distinguish missing PATH command, invalid override shape, and missing configured runner.
- R8. Command-resolution failures point agents at `configure_adapter_dependency` through `continuation.next_action_id`.
- R9. Command-resolution failures do not invite same-input retry until the missing tool or invalid override is fixed.

## Key Technical Decisions

- KTD1. **JSON-array override:** Use `BROWSER_USE_MCPORTER_COMMAND_JSON` for command vectors. This aligns with Node/Bun/Python spawn best practice and avoids shell parsing.
- KTD2. **PATH first:** Default to `["mcporter"]`; callers who prefer `bunx`, `npx`, `pnpm dlx`, or wrappers configure the override explicitly.
- KTD3. **Append subcommands after the base vector:** Runtime builds commands like `[...base, "config", "get", ...]` and `[...base, "call", ...]`.
- KTD4. **Adapter setup failure, not browser entry:** Command-resolution failures stay in Browser Adapter Proof setup; no Warm Chrome repair, adapter fallback, or cold browser path.
- KTD5. **Recovery hints are command-resolution facts:** Hints should name the checked command source, the accepted override shape, and safe examples. They should not prescribe one package runner as the fix.
- KTD6. **Continuation owns the next move:** Command-resolution failures use `configure_adapter_dependency`, referenced through `continuation.next_action_id`. Do not create prose-only recovery paths.
- KTD7. **Override discovery:** `BROWSER_USE_MCPORTER_COMMAND_JSON` appears in the runtime command contract with JSON-array shape, non-empty string constraint, shell-string rejection, and no automatic package-runner fallback.
- KTD8. **Explicit runner side effects:** Package-runner override examples are local operator choices and may have network/cache side effects. PATH `mcporter` remains the only quiet default.
- KTD9. **Invalid override gets a precise code:** Invalid `BROWSER_USE_MCPORTER_COMMAND_JSON` emits `adapter_command_override_invalid`; missing PATH command or configured runner emits `adapter_dependency_missing`. Both use exit `20` and `configure_adapter_dependency`.
- KTD10. **Code belongs to package vocabulary:** Add `adapter_command_override_invalid` to Browser Adapter Proof's package-owned diagnostic vocabulary.
- KTD11. **No availability pre-check:** Spawn the selected command vector and classify failure from the actual command result. Do not run `which`, parse PATH manually, or create a separate lookup path.
- KTD12. **Runner examples are examples only:** Recovery hints may show `["bunx","mcporter"]`, `["npx","-y","mcporter"]`, and `["pnpm","dlx","mcporter"]` as operator-selected examples. Hints must also say Browser Adapter Proof does not auto-try package runners.

## Implementation Units

### U1. Add command-vector resolution to Browser Adapter Proof

- **Goal:** Replace hardcoded `bunx mcporter` invocations with a small resolver that returns the base command vector.
- **Files:** `skills/browser-use/scripts/preflight-browser-adapter.ts`, `skills/browser-use/scripts/command-contract.ts`
- **Patterns:** Follow existing `AdapterCommandInput`, `runCommand`, and `AdapterProofRuntimeError` handling in `preflight-browser-adapter.ts`.
- **Test Scenarios:**
  - Default resolution runs `mcporter config get chrome-devtools --json`.
  - JSON override `["bunx","mcporter"]` runs `bunx mcporter config get chrome-devtools --json`.
  - JSON override `["npx","-y","mcporter"]` runs `npx -y mcporter config get chrome-devtools --json`.
  - Invalid JSON override fails with `adapter_command_override_invalid` and hint text naming JSON array shape.
  - Empty array, non-string members, and blank/whitespace-only string members fail with `adapter_command_override_invalid`.
  - `BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES` includes `adapter_command_override_invalid`.
  - Missing default `mcporter` hints: expose `mcporter` on PATH or set `BROWSER_USE_MCPORTER_COMMAND_JSON`.
  - Missing configured runner hints: the configured command could not start, and the JSON-array override should be checked.
  - Recovery hints include neutral command-vector examples and explicitly reject package-runner auto-fallback.
  - Missing command detection comes from spawn/result classification, not a separate PATH pre-check.
  - Every command-resolution failure emits a `configure_adapter_dependency` `runtime_actions` entry referenced by `continuation.next_action_id`.
  - Command-resolution failures set retry posture so agents do not rerun the same input before fixing setup.
  - Runtime command contract exposes `BROWSER_USE_MCPORTER_COMMAND_JSON`.
- **Verification:** Focused Bun tests for `preflight-browser-adapter.test.ts`.

### U2. Align tests and docs with ADR 0011

- **Goal:** Update test fixtures and references so they assert runner-neutral public behavior and configured local runner behavior.
- **Files:** `skills/browser-use/scripts/preflight-browser-adapter.test.ts`, `skills/browser-use/references/browser-adapter-chrome-devtools.md`, `skills/browser-use/PROVENANCE.md`
- **Patterns:** Keep `skills/browser-use/SKILL.md` hot path lean; use docs only for local setup and recovery explanation.
- **Test Scenarios:**
  - Existing successful adapter proof tests pass with PATH-default `mcporter`.
  - Existing local setup can still be represented with JSON override in fixtures.
  - Missing `mcporter` reports `adapter_dependency_missing`.
  - Missing configured runner reports `adapter_dependency_missing`.
  - Recovery examples include PATH plus explicit local override examples such as `["bunx","mcporter"]`, `["npx","-y","mcporter"]`, and `["pnpm","dlx","mcporter"]`, labeled as operator-selected runner commands.
  - Recovery wording never says to switch adapters, relaunch Warm Chrome, or use a cold browser.
  - Plain output names the same recovery action as JSON `continuation.next_action_id`.
  - Search confirms `SKILL.md` does not present `bunx mcporter` as the hot-path example.
- **Verification:** Skill validator plus focused Browser Adapter Proof test file.

## Scope Boundaries

- Do not add `mcporter` as a repo dependency in this slice.
- Do not auto-try `bunx`, `npx`, or `pnpm dlx`.
- Do not change Warm Chrome Preflight behavior.
- Do not implement broader Browser Adapter support beyond `chrome-devtools`.
- Do not implement Browser Adapter capability routing, forced/prefer/auto policy, or capability research recovery in this slice.
- Do not implement post-proof Chrome DevTools action invocation in this slice.
- Do not treat `BROWSER_USE_MCPORTER_COMMAND_JSON` as support for post-proof `mcporter call ...` examples; if proof used an override because `mcporter` is not on PATH, keep agents out of those examples until Browser Adapter Router owns action invocation.
- Do not require every skill to adopt CLI command resolution machinery.

## Acceptance Examples

- AE1. Given no override and `mcporter` exists on PATH, when Browser Adapter Proof inspects config or lists pages, then it invokes `mcporter` directly.
- AE2. Given `BROWSER_USE_MCPORTER_COMMAND_JSON='["bunx","mcporter"]'`, when Browser Adapter Proof inspects config or lists pages, then it invokes `bunx mcporter` plus the relevant `mcporter` subcommand arguments.
- AE3. Given `BROWSER_USE_MCPORTER_COMMAND_JSON='npx -y mcporter'`, when Browser Adapter Proof starts, then it fails with `adapter_command_override_invalid`, emits a recovery hint that the override must be a JSON array of strings, and does not shell-evaluate the string.
- AE4. Given no override and `mcporter` is missing from PATH, when Browser Adapter Proof runs, then it fails with `adapter_dependency_missing` and hints to expose `mcporter` on PATH or configure `BROWSER_USE_MCPORTER_COMMAND_JSON`.
- AE5. Given no override and `mcporter` is missing, when Browser Adapter Proof runs, then it does not automatically try `bunx`, `npx`, `pnpm dlx`, or any other package runner.
- AE6. Given any command-resolution failure, when JSON output is emitted, then `continuation.next_action_id` is `configure_adapter_dependency`, references a current `runtime_actions[].id`, and the recovery wording names missing-tool setup rather than Warm Chrome repair, adapter fallback, or cold-browser fallback.
- AE7. Given command contract discovery is requested, when Browser Adapter Proof emits its contract, then it includes `BROWSER_USE_MCPORTER_COMMAND_JSON` with JSON-array shape guidance.
- AE8. Given Browser Adapter Proof succeeds only because `BROWSER_USE_MCPORTER_COMMAND_JSON` points at a local runner, when the skill reaches post-proof `mcporter call ...` examples, then recovery text does not send the agent into those examples until Browser Adapter Router owns action invocation.

## Risks & Dependencies

- The exact env var name must be stable once shipped; prefer one clear name over multiple aliases.
- `Bun.spawn` already supports command arrays, so the implementation should stay small.
- Tests currently fixture exact `bunx mcporter` command strings; most churn will be in test fixtures, not runtime behavior.
- Broader Browser Adapter Router work is tracked separately in `skills/browser-use/docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md`.

## Sources

- ADR: `docs/adr/0011-skill-prose-names-tools-clis-resolve-invocation.md`
- Glossary: `CONTEXT.md`
- Runtime: `skills/browser-use/scripts/preflight-browser-adapter.ts`
- Tests: `skills/browser-use/scripts/preflight-browser-adapter.test.ts`
- Skill prose: `skills/browser-use/SKILL.md`
