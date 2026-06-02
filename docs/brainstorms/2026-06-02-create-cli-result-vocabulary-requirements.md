---
date: 2026-06-02
topic: create-cli-result-vocabulary
---

# Create CLI Result Vocabulary Requirements

## Summary

Add a small create-cli guidance update that makes `skills/create-cli/references/cli-command-facade.md` the canonical owner for package-owned result vocabulary guidance. The update should clarify that the facade owns shared contract shape, while each package owns stable agent-facing literals inside that shape.

---

## Problem Frame

The Browser Adapter Proof work exposed a create-cli guidance gap. `@side-quest/cli-command-facade` makes shared CLI contract shape explicit, but stable package-specific output values can still become agent-facing contract without being owned by the facade schema.

When those literals stay in implementation-local unions, docs, tests, parsers, and callers can depend on values that have no clear contract owner. Future CLI authors need a compact rule for where those values live and how prose should point to them.

---

## Key Decisions

- **Canonical owner:** Put the guidance in `skills/create-cli/references/cli-command-facade.md`, near `resultContract` and runtime output guidance.
- **Reference-only update:** Leave `skills/create-cli/SKILL.md` unchanged; it already routes implementers to the facade reference.
- **Boundary language:** Describe the ownership split, not package-specific member lists.

---

## Requirements

**Ownership boundary**

- R1. The guidance distinguishes facade-owned contract shape from package-owned result vocabulary.
- R2. The facade-owned side includes shared envelope shape, `resultContract` identity fields, runtime action shape, and diagnostic flag reservation.
- R3. The package-owned side includes stable agent-facing literals such as diagnostic codes, source labels, statuses, action ids, parser enum values, and routing labels.

**Author guidance**

- R4. The guidance tells authors to export package-owned runtime constants and types beside the package `CommandFacadeContract`.
- R5. The guidance tells authors to derive parser, runtime, tests, and docs examples from those runtime constants when the values are stable.
- R6. The guidance frames implementation-local string unions as a smell once docs, tests, callers, or agents rely on the values.
- R6a. The guidance defaults vocabulary constants to the same contract module, with a sibling vocabulary module allowed when the catalog gets noisy; the contract module still points to or exports the owner.

**Documentation discipline**

- R7. The update keeps prose pointing at the contract owner rather than restating member lists.
- R8. The update stays small enough to avoid creating a parallel policy surface.

---

## Scope Boundaries

- No update to `skills/create-cli/SKILL.md`.
- No broad rewrite of create-cli guidance.
- No new reference file.
- No duplicated lists of browser-use diagnostic codes, source labels, statuses, or adapter values.
- No implementation changes in `skills/browser-use/scripts/`.

---

## Acceptance Examples

- AE1. **Covers R1-R6.** Given a CLI emits stable package-specific values in facade-shaped output, when authors write the command contract, then those values are exported beside the package contract and imported by parser/runtime/tests instead of living only in implementation-local unions.
- AE2. **Covers R7-R8.** Given package-specific values already exist in one package, when create-cli documents the principle, then it names the ownership rule and example categories without copying that package's full value catalog.

---

## Sources

- GitHub issue: `nathanvale/claude-code-config#155`
- Facade guidance owner: `skills/create-cli/references/cli-command-facade.md`
- Current create-cli front door: `skills/create-cli/SKILL.md`
- Example contract-owner pattern: `skills/browser-use/scripts/command-contract.ts`
