# Browser Adapter Contract Shape Notes

Source: prototype request on 2026-06-03.

## Question

- Test whether one adapter contract shape can feed proof runtime, map validation, authoring, and Router evidence.
- Find which fields belong in shared catalogue data.
- Find which fields belong in adapter-local proof specs.
- Avoid duplicating recovery vocabulary in maps.

## Early Answer

- One composed contract shape feels viable.
- Keep diagnostic vocabulary and canonical recovery targets shared.
- Keep adapter probes, dependency surfaces, and exact commands adapter-local.
- Generate consumer projections from the contract shape.
- Treat Router evidence as a projection, not a separate source of truth.

## Shape Candidate

- `diagnostic_catalog`: code -> recovery target -> map section -> severity behavior.
- `adapter_specs`: adapter id -> emitted diagnostics -> proof probes -> command slots.
- `map_contract`: required sections -> expected keys -> source path.
- `router_projection`: proof success -> adapter id -> endpoint -> warnings.

## Prototype Learning

- Duplicated per-consumer specs drift quickly.
- Router evidence should not know repair commands.
- Map checker should not infer emitted diagnostics from prose.
- Authoring can use the same shape but should remain draft-only.
- Exact local commands still belong in map source or adapter-local command slots.

## Production Shape Candidate

- Put shared vocabulary in `skills/browser-use/src/command-contract.ts`.
- Put adapter proof specs near Browser Adapter Proof runtime.
- Export projection helpers for map validation and authoring.
- Keep generated Router evidence shape minimal.
- Avoid making Browser Adapter Map prose the contract owner.

## Open Questions

- Should adapter proof specs live in `preflight-browser-adapter.ts` or a sibling contract module?
- Should map authoring use production projection helpers, or stay separate until the second map lands?
- Should Router projection include warning codes or only a warning count?
- Should map checker validate exact command slots or only recovery keys?
