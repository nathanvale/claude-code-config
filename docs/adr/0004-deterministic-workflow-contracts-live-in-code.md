---
status: accepted
date: 2026-05-26
---

# Deterministic Workflow Contracts Live in Code

ADR 0002 sets the broad placement rule: prose orchestrates judgment, code owns
determinism, templates own repeated handoffs, references own rare explanation.
Issue-to-PR v2 exposed the next constraint: even well-split references become
hard to maintain when they carry thousands of lines of deterministic contract
detail.

This ADR refines ADR 0002. It decides what belongs in hand-maintained prose and
what must move behind runtime code, generated docs, or CLI diagnostics.

## Decision

Hand-maintained prose may carry intent, judgment, role boundaries, user gates,
and stop conditions. It must not be the source of truth for deterministic
workflow contracts.

Hard rule:

```text
No hand-maintained prose may duplicate deterministic contracts.
```

Prose may name a contract, link to its runtime source, or show the command that
emits it. Prose must not restate the contract's members.

When a rule can be enumerated, classified, parsed, rendered, validated,
deduplicated, normalized, selected, or diagnosed from durable inputs, put the
rule in executable code. Expose it through a stable CLI or runtime helper. If
humans need to read it, generate or emit the human-facing view from the same
runtime source.

The durable source of truth order is:

1. Runtime code and data constants for deterministic contracts.
2. CLI JSON envelopes for machine-consumed facts and diagnostics.
3. Generated markdown or CLI explain output for human-readable contract views.
4. Hand-maintained prose for orchestration and judgment only.

## Placement Test

Keep it in prose when the agent must answer:

- What is the purpose of this workflow?
- Who owns this decision?
- Which human confirmation is required?
- What trade-off or risk should the user understand?
- What judgment applies when the facts are incomplete?
- When must the workflow stop and ask?

Move it to code when the agent can ask:

- What route is this ledger in?
- Which references are required for this route?
- Which schema fields are allowed or required?
- Which statuses, reasons, or transitions are valid?
- Which findings block convergence?
- Which personas should run for these paths and signals?
- Which packet should be rendered for this role and target?
- Which digest or ledger section drifted?
- Which recovery recipe applies to this diagnostic state?

## Code-Owned Surfaces

These surfaces must not be duplicated in hand-maintained prose:

- Route tables.
- Required-reference maps.
- Schema fields.
- Allowed statuses.
- Recovery recipes.
- Persona selection.
- Packet shapes.
- Closure rules.
- Route classification.
- Finding dedupe and canonical-row rules.
- Open P0/P1 predicates and convergence gates.
- Runbook-version skew and continuation-evidence validation.
- Installed-artifact presence checks.
- Digest computation and stale-state classification.

Hand-maintained prose may point at these surfaces, but must not duplicate their
tables, field lists, examples, or transition rules.

## Prose-Owned Surfaces

These surfaces remain prose-owned:

- Workflow purpose and stage intent.
- Role boundaries: Orchestrator, Builder, Proposer, Validator, user.
- Human confirmation gates.
- One-visible-action discipline.
- Local Law read order and repo-governance respect.
- Safety principles such as bounded Orchestrator context and Validator-owned
  correctness findings.
- Judgment-heavy rules such as "smallest coherent diff", "obvious low-risk
  change", and "accepted risk".
- Stop-and-ask wording and operator-facing escalation.

If a prose-owned rule starts accumulating field lists, transition tables,
persona routing conditions, packet member lists, or copy-paste recovery
recipes, split the deterministic part into code and keep only the judgment
wrapper in prose.

## Generated Human Views

Human-readable docs for code-owned contracts should be generated or emitted from
runtime sources. Acceptable forms:

- `cli.ts contract <slice> --json` for machine use.
- `cli.ts explain <slice>` for compact operator use.
- Generated markdown committed beside references when stable docs are useful.
- `cli.ts diagnose --json` for state-specific recovery evidence.

Generated docs must say which command or source produced them. Manual edits to
generated contract docs are bugs; update the runtime source instead.

## Issue-to-PR v2 Application

Issue-to-PR v2 must reduce hand-maintained operational prose by moving these
areas first:

1. Replace duplicated route/reference prose with `route.ts` and CLI contract
   output.
2. Replace `first-run-gotchas.md` recovery recipes with diagnostic codes and
   recovery facts from `cli.ts diagnose`.
3. Move ledger schema prose into runtime contract constants plus generated
   schema docs.
4. Move finding lifecycle and closure validation into helper code, with prose
   keeping only risk and role explanation.
5. Move persona selection into a deterministic selector that emits selected
   personas and evidence.
6. Keep Stage 4 dispatch judgment in prose only for subjective gates; encode
   hard gates and evidence validation in code.

After migration, hand-maintained Issue-to-PR prose must contain no duplicated
route tables, required-reference maps, schema fields, allowed statuses,
recovery recipes, persona-selection tables, packet shapes, or closure-rule
tables.

Do not weaken Issue-to-PR safety while shrinking prose. Migration means the CLI
proves more facts; it does not make the CLI the Orchestrator.

## Consequences

- Runtime code becomes the review target for deterministic workflow behavior.
- Prose reviews focus on judgment, role boundaries, and operator clarity.
- Large reference files are suspect by default when they contain tables,
  schemas, route maps, recovery recipes, or normalized envelopes.
- Tests must cover deterministic contracts at the code seam, not through prose
  grep alone.
- ADR 0002 still holds: prose decides when a fact matters; code emits and
  validates the fact.
- Existing workflows may migrate incrementally, but new workflow contracts must
  start with this placement rule.
