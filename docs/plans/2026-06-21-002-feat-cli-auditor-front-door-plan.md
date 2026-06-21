---
title: "feat: Add CLI auditor front-door station-map support"
type: feat
date: 2026-06-21
---

# feat: Add CLI auditor front-door station-map support

## Summary

Add full front-door support to the CLI Execution Auditor without changing its public CLI contract. The work partitions audit ledgers by package and front door, teaches Station Map mode to discover and reconcile per-front-door catalogs, and adds fixture coverage for the new behavior.

---

## Problem Frame

Facade-backed packages can host multiple CLIs under `src/front-doors/<name>/`. `audit` already discovers multiple command contracts, but both commands still write a single `docs/cli-audits/<pkg>/audit.md`, and `station-map` still assumes a single root catalog.

---

## Requirements

- R1. `station-map` discovers root and front-door Branch Station Catalogs with the same depth-N pattern as command contract discovery.
- R2. `station-map` projects each catalog against the commands owned by that catalog's front door.
- R3. Cross-front-door station-id collisions produce deterministic findings naming both catalog files.
- R4. `audit` writes default ledgers to `docs/cli-audits/<pkg>/<front-door>/audit.md`.
- R5. `station-map` writes default ledgers to `docs/cli-audits/<pkg>/<front-door>/audit.md`.
- R6. Existing flags, help, result contract ids, schema version, and exit codes stay unchanged.

---

## Key Technical Decisions

- **Per-finding attribution:** Add a `frontDoor` field to audit and station findings. This keeps the JSON result shape mostly stable while giving the runtime enough structure to split ledgers.
- **Per-catalog station projection:** Call the existing station asset worker once per catalog. This mirrors command contract acquisition and avoids widening worker responsibilities.
- **Root surface label:** Use `root` for package-level contracts and catalogs. Front-door labels come from the path under `src/front-doors/`.
- **Ledger default only:** Split only default ledger paths. A user-supplied `--ledger` remains a single explicit destination because the caller chose it.

---

## Implementation Units

### U1. Station catalog discovery

- **Goal:** Add catalog discovery that finds root and front-door catalog files in canonical order.
- **Requirements:** R1.
- **Dependencies:** None.
- **Files:** `skills/cli-execution-auditor/src/command-contract-discovery.ts`, `skills/cli-execution-auditor/src/station-map.test.ts`.
- **Approach:** Mirror `discoverCommandContractPaths` with `discoverStationCatalogPaths`.
- **Patterns to follow:** Existing command contract discovery sort order.
- **Test scenarios:** Root-only catalog remains detected; two front-door catalogs are returned in sorted path order.
- **Verification:** Discovery tests fail before the implementation and pass after it.

### U2. Station Map front-door reconciliation

- **Goal:** Project Station Maps per catalog and preserve each front-door's evidence file.
- **Requirements:** R1, R2, R3.
- **Dependencies:** U1.
- **Files:** `skills/cli-execution-auditor/src/station-map.ts`, `skills/cli-execution-auditor/src/station-map.test.ts`, `skills/cli-execution-auditor/src/fixtures/**`.
- **Approach:** Derive a front-door label from each catalog path, filter acquired contracts to that label, load matching evidence, and merge station maps for the command result.
- **Patterns to follow:** `acquireTargetContracts` collision reporting and `stationFindingsFromMap` deterministic sorting.
- **Test scenarios:** Two front-door catalogs with complete evidence return no findings; a missing front-door evidence row produces a finding attributed to that front door; duplicate station ids across catalogs name both catalog files.
- **Verification:** Station-map fixture tests cover good and bad multi-catalog cases.

### U3. Per-front-door ledger partitioning

- **Goal:** Default ledgers split by package and front door for both commands.
- **Requirements:** R4, R5, R6.
- **Dependencies:** U2 for station findings; audit attribution can land independently.
- **Files:** `skills/cli-execution-auditor/src/audit-engine.ts`, `skills/cli-execution-auditor/src/auditor.ts`, `skills/cli-execution-auditor/src/auditor.test.ts`.
- **Approach:** Attribute audit findings by command ownership, group findings by `frontDoor`, and write one default ledger per group. Keep explicit `--ledger` behavior unchanged.
- **Patterns to follow:** Current ledger dedupe and never-delete semantics in `src/ledger/`.
- **Test scenarios:** Two front-door audit findings write two default ledgers; explicit `--ledger` writes one requested file; station findings write per-front-door ledgers.
- **Verification:** End-to-end runtime tests assert ledger paths and file contents.

### U4. Contract and regression proof

- **Goal:** Prove the auditor's own CLI surface did not drift.
- **Requirements:** R6.
- **Dependencies:** U1, U2, U3.
- **Files:** `skills/cli-execution-auditor/src/auditor.test.ts`, `skills/cli-execution-auditor/src/command-contract.ts`.
- **Approach:** Keep existing contract tests unchanged except for expected data shape additions.
- **Test scenarios:** Contract parse still passes; help still renders `audit` and `station-map`; invalid argv behavior remains unchanged.
- **Verification:** Full auditor test suite and typecheck pass.

---

## Scope Boundaries

- Do not change `audit` or `station-map` flags, help, result contract ids, schema version, or exit codes.
- Do not rewrite `SKILL.md` or reference docs.
- Do not add the inline `--flag=value` clause in this change.
- Do not run `/create-cli`; the auditor CLI surface is unchanged.

---

## Sources / Research

- Handoff: `/var/folders/_b/0fxx_szx34qchf5vq6j5xd1h0000gn/T/handoff-cli-auditor-front-door-20260621-151355.md`.
- Existing front-door discovery: `skills/cli-execution-auditor/src/command-contract-discovery.ts`.
- Audit acquisition pattern: `skills/cli-execution-auditor/src/audit-engine.ts`.
- Station Map owner: `skills/cli-execution-auditor/src/station-map.ts`.
- Ledger owner: `skills/cli-execution-auditor/src/auditor.ts`.
