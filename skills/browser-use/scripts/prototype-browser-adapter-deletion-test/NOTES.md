# Browser Adapter Deletion Test Notes

Source: prototype request on 2026-06-03.

## Question

- Identify which candidate modules earn depth.
- Use deletion test to find leverage and locality.
- Avoid promoting every prototype into production code.
- Keep two-adapter seams real, not hypothetical.

## Early Answer

- `RecoveryCatalogue` earns production depth.
- `AdapterProofSpec` earns production depth once `agent-browser` proof lands.
- `ProjectionEngine` is worth exploring, but may be a small internal module.
- `MapAuthoringHelper` should stay draft-only until a real second map exists.
- `ExplanationRenderer` may be shallow unless it enforces code/action consistency.
- `ReplayOutcomeEngine` is mostly test harness learning unless retry semantics become runtime-owned.

## Strong Candidates

- `RecoveryCatalogue`: central diagnostic -> action -> section mapping.
- `AdapterProofSpec`: per-adapter emitted diagnostics and proof probes.

## Worth Exploring

- `ProjectionEngine`: derives map validation, authoring, and Router evidence views.
- `ExplanationRenderer`: derives plain and Router summaries from shared facts.

## Keep Prototype-Only For Now

- `MapAuthoringHelper`: useful for authoring but not yet a production runtime surface.
- `ReplayOutcomeEngine`: useful for smoke design, not yet a domain module.

## Production Shape Candidate

- Extract shared deterministic vocabulary into code-owned data.
- Keep Browser Adapter Map prose as operator guidance, not source of truth.
- Keep Router evidence minimal.
- Add tests at the module interface, not through markdown grep alone.

## Open Questions

- Should `ProjectionEngine` be a named module or private functions behind map validation?
- Should `ExplanationRenderer` be part of proof runtime or command contract projection?
- Which retry and recovery outcome semantics are runtime-owned?
- Does `AdapterProofSpec` include exact commands, or only proof probes and emitted diagnostics?
