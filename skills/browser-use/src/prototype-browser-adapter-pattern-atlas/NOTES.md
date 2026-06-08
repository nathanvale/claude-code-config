# Browser Adapter Pattern Atlas Notes

Source: prototype reframe on 2026-06-03.

## Question

- Reframe away from production modules.
- Compare adapter patterns directly.
- Find DRY boundaries from repeated facts, not desired abstractions.
- Keep prototype throwaway.

## Early Answer

- DRY the lifecycle stage names.
- DRY canonical diagnostic and action vocabulary.
- DRY map coverage checks.
- Do not DRY exact commands, dependency setup, or probe interpretation yet.
- Drift usually appears when map prose invents a synonym for a canonical action.

## Pattern Buckets

- Shared lifecycle: entry proof, dependency check, binding proof, action probe, warning scan, map handoff.
- Shared recoverability: stable code, canonical action, map section, severity.
- Adapter-local proof: dependency surface, command vector, probe output, weak-signal interpretation.
- Adapter-local operator repair: install/config commands and local file paths.

## Prototype Learning

- Healthy DRY means both adapters can explain the same stage without sharing command details.
- Over-DRY appears when a shared helper needs adapter-specific branches for every useful line.
- Missing second-adapter facts make production models feel deeper than they are.
- A pattern atlas is a better next artifact than another module candidate.

## Next Safe Action

- Use this prototype to name the shared stages and local fact slots.
- Delay production `AdapterProofSpec` until `agent-browser` proof facts are real.
- Keep any existing production spike separate from this exploration.

