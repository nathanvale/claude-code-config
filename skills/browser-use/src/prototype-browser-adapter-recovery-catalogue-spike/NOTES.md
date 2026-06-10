# Browser Adapter Recovery Catalogue Spike Notes

Source: accidental production spike on 2026-06-03.

## Question

- Preserve the useful learning from `browser-adapter-recovery-catalogue.ts`.
- Remove production pressure.
- Keep catalogue shape inspectable as a spike.

## What Worked

- Central diagnostic -> action -> section mapping is coherent.
- Expected Recovery Map keys can be derived mechanically.
- `warning_only` needs explicit handling for weak-signal success.
- Warm Chrome actions should not be pulled into Browser Adapter Map recovery coverage.

## What Was Too Early

- Production module before a real second adapter map.
- Production `AdapterProofSpec` before real `agent-browser` proof facts.
- Map checker depending on a new catalogue before we decide the contract owner.

## Spike Verdict

- Keep the catalogue idea as a candidate.
- Do not wire it into runtime yet.
- Use it to evaluate future `agent-browser` proof facts.
- Graduate only after two real adapter maps need the same machinery.

## Next Safe Action

- Restore production files to their pre-spike shape.
- Keep this folder as the collated spike artifact.
- Revisit when `agent-browser` emits real diagnostic and recovery facts.

