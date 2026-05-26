---
title: "feat: Drift coverage hardening (entry envelope + visible-command + reverse pointer)"
type: feat
status: draft
date: 2026-05-26
origin: /tmp/compound-engineering/ce-code-review/20260526-200859-40ef56b2/synthesis.json
target_repo: nathanvale/claude-code-config
---

# feat: Drift coverage hardening

## Summary

Close four advisory gaps surfaced by the CE re-review of `codex/route-reference-contract` (run id `20260526-200859-40ef56b2`). All four are scope/coverage gaps in the runtime contract drift check, not correctness bugs in the work that just landed. Group them here so a future slice can resolve them together instead of carrying four open advisories.

---

## Problem Frame

The re-review confirmed the route reference, ledger schema, builder/validator scaffold renderer, and ce-plan addendum work is correct, tested, and ADR-0004/0005-aligned. Four residual advisories remain:

1. The `contract-drift.ts` runnable entrypoint emits prose, not a `CliSuccessEnvelope`, so an agent that runs the drift check as a subprocess must scrape text to route on `DriftFinding.kind`. Exported API is machine-readable; only the script entry is not.
2. `checkVisibleScaffoldCommands` correlates a visible `cli.ts scaffold <id> --json` claim with markers within 3 lines after the command only. A visible command with no nearby marker passes silently.
3. `checkVisibleScaffoldCommands` runs only over `SCAFFOLD_COMMAND_SURFACE_RELS`, not all `SCOPED_DOCS`. A stale visible command in an unscoped doc (plan, brainstorm, runbook section) is not caught.
4. Drift catches additions/renames in `LEDGER_SCHEMA_POINTER_SLICES`, but not removals: deleting a slice from the catalog while leaving a stale `cli.ts contract <slice> --json` pointer in the ledger template or helper goes undetected.

---

## Requirements

- R1. Drift CLI entry emits a `CliSuccessEnvelope` (or a documented error envelope) so agents can route on finding kinds without text scraping.
- R2. Visible `cli.ts scaffold <id> --json` claims in `SCAFFOLD_COMMAND_SURFACE_RELS` docs that have no adjacent generated/pointer marker are reported as drift.
- R3. Visible `cli.ts scaffold <id> --json` claims in any `SCOPED_DOCS` doc (not just `SCAFFOLD_COMMAND_SURFACE_RELS`) are validated against the runtime scaffold-id catalog.
- R4. Removing a slice from `LEDGER_SCHEMA_POINTER_SLICES` while leaving a stale pointer in the ledger template or `ledger-and-helper.md` is reported as drift.
- R5. No regression in existing `contract-drift.test.ts` coverage; SSOT exhaustiveness test for scaffold ids continues to pass.

## Scope Boundaries

- Plan only the four advisory gaps above. Do not extend drift coverage to gotchas-relationship checks, packet-shape drift, or response-shape drift in this slice.
- Do not refactor `contract-drift.ts` for size; the 2200-line file is a watch-zone, not in-scope here.
- Do not change scaffold rendering, ledger schema contract slices, or route reference contract behavior.

## Implementation Units

- U1. Drift CLI envelope contract — wrap the runnable entrypoint output in `CliSuccessEnvelope`. Add cli-smoke coverage that parses the envelope. (R1)
- U2. No-marker visible-command drift — extend `checkVisibleScaffoldCommands` so a visible command in a surface doc with no marker in the lookahead window produces a `scaffold-command` finding. Add a `stageDriftSurfaceFixture` test where the marker is deleted but the command remains. (R2)
- U3. Unscoped-doc visible-command coverage — broaden the iteration set in `checkVisibleScaffoldCommands` to every `SCOPED_DOCS` entry. Add a test fixture that places a wrong-but-valid `cli.ts scaffold <id> --json` claim in a doc outside `SCAFFOLD_COMMAND_SURFACE_RELS`. (R3)
- U4. Reverse ledger-pointer check — add a scan over the ledger template and `ledger-and-helper.md` for `cli.ts contract <slice> --json` occurrences whose slice is in `CONTRACT_SLICES` but missing from `LEDGER_SCHEMA_POINTER_SLICES`. Emit a `ledger-schema-slice-pointer` finding. Add a fake-stale-doc test that removes a slice from the runtime catalog and asserts the stale template pointer is flagged. (R4)

## Verification

- `bun test runbooks/issue-to-pr-v2/contract-drift.test.ts` passes including new fixtures for each unit.
- `bun test runbooks/issue-to-pr-v2/cli-smoke.test.ts` passes including new envelope-shape test for the drift entrypoint.
- `bunx tsc --noEmit` clean.
- `bun run biome:check runbooks/issue-to-pr-v2` clean.

## References

- Re-review synthesis: `/tmp/compound-engineering/ce-code-review/20260526-200859-40ef56b2/synthesis.json`
- ADR 0002 (CLI is the deterministic front door)
- ADR 0004 (Deterministic workflow contracts live in code)
- ADR 0005 (Template scaffold contracts are runtime-owned)
- Memory: `feedback_route_catalog_extractor_format.md`
