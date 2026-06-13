---
title: "Skill-feedback ICA vocabulary convergence map"
type: audit-map
date: 2026-06-13
owner: skills/skill-feedback
source:
  - docs/decisions/2026-06-12-001-skill-feedback-pilot-decision-log.md
  - docs/plans/2026-06-13-001-feat-skill-feedback-claim-safe-review-result-v2-plan.md
  - skills/skill-feedback/CONTEXT.md
---

# Skill-feedback ICA vocabulary convergence map

## Scope

- Audit skill-feedback docs, references, plans, decisions, and prototypes.
- Exclude runtime implementation changes.
- Treat `skills/skill-feedback/CONTEXT.md` as domain vocabulary owner.
- Treat `improve-codebase-architecture/LANGUAGE.md` as ICA vocabulary owner.
- Treat `skills/skill-feedback/src/command-contract.ts` as deterministic field and enum owner.

## Canonical Terms

- Use `ReviewResultData Facade` for the claim-safe review result Interface.
- Name `ReviewResultData` as the Interface at the reducer Seam.
- Use `Anchor Adapter` only for the internal Adapter that emits canonical anchor facts for the reducer.
- Use `Claim Strategy` for reducer-owned allowed-claim derivation.
- Use `Reducer flow` for the fixed review pipeline.
- Use `Review unit` only for trusted `skill_run_id` bundles or report-local units.
- Use `Trusted skill identity` for engine-owned evidence that a named skill ran.
- Use `Stop-detected turn` for Codex Stop evidence without skill identity.
- Use `Stop-detected skill` for runtime evidence that can name a skill from supported runtime evidence.
- Use `Evidence source` for hook capture versus driver closeout.
- Use `Capture runtime` for Claude Stop, Codex Stop, or Codex notify.
- Use `Daily pilot` for the normal-use phase gated by review/correlation work and true Codex end-to-end proof.

## ICA Rules

- Use `Seam` where the Interface location matters.
- Use `Interface` for what callers, renderers, tests, and future agents depend on.
- Use `Module` only for things with Interface plus Implementation.
- Use `Adapter` only for a concrete thing satisfying an Interface at a Seam.
- Use `Depth`, `Locality`, `Leverage`, and deletion test only where they explain why a field or Module pays rent.
- Keep renderers as consumers, not claim owners.

## Audit Checks

- Search for lowercase or generic identity drift: `trusted identity`, `trusted Codex identity`.
- Search for pilot drift: `daily pilot`, `daily-pilot readiness`.
- Search for collapsed readiness drift: `capture_readiness`, `implementation readiness`.
- Search for ICA drift: `reducer Seam`, `anchor Seam`, `boundary`, `component`, `service`, `API`.
- Search for output-owner drift: `JSON facade`, `renderer inference`, `evidence sources`.
- Treat matches in historical decisions as immutable unless a new superseding decision is added.

## Next Safe Action

- Patch docs and references first.
- Patch prototype prose and display strings only when they can mislead a future agent.
- Leave exact prototype field names alone unless implementation absorption decides new field names.
- Keep code-owned field names, enum values, parser behavior, and help text in `command-contract.ts` and tests.
