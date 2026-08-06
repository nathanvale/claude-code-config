---
name: path-component-parity
description: "Measure Path-theme component parity against a canonical Storybook component and drive supported deltas to zero."
---

# Path Component Parity

Treat portal-ui as the reference. Change only Path theme owners or an earned
runtime adapter seam.

## Route

- When working in another repository that contains a repo-local
  `skills/path-component-parity/SKILL.md`, read that file first. It owns
  project support gates, coverage contracts, and styling constraints.
- Require the Path story id, canonical portal-ui story id, and comparable
  variant selectors.
- Read [the workflow](references/workflow.md) after the story pair is known.
- Run `scripts/measure-computed.mjs --help`; keep exact inputs and output
  semantics with the script.
- Stop before changing source when more than one canonical counterpart remains
  plausible.

## Next Safe Action

Measure one component through every supported variant and state. Fix only the
reported Path deltas, regenerate the theme artifact, then rerun the identical
measurement to zero.
