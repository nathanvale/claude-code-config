---
name: design-parity-session
description: "Run live design parity when comparing Figma, Storybook, or MATest against an approved component or page reference."
---

# Design Parity Session

Drive one visual parity loop while keeping design extraction, live browser
setup, component measurement, and durable evidence with their existing owners.

## Source Split

- Figma owns approved page composition, content, spacing, and placement.
- The canonical component story owns component appearance, variants, states,
  and behaviour.
- Storybook or MATest is the implementation surface being proved.

Stop when the reference pair or ownership class is ambiguous. Never use a
one-off page instance to redefine a canonical component.

## Dependencies

- `figma`: hard dependency when Figma is a source. Missing state: blocked for
  Figma comparison. Next repair: follow its MCP state route.
- `browser-use`: hard dependency for live browser proof. Missing state:
  blocked. Next repair: restore its CLI and follow its returned continuation.
- `matest-session`: optional handoff for a live Experience extension. Missing
  state: degraded to Storybook or another already-running implementation
  surface.
- `path-component-parity`: optional handoff for component-level Path parity.
  Missing state: degraded to screenshot and computed-style evidence without
  the component measurement driver.

## Workflow

1. Resolve the approved reference, implementation surface, viewport, and
   target page or component.
2. Classify the task as page composition, component parity, or both. Keep the
   evidence and fixes separate when both apply.
3. Hand Figma extraction to `figma`. Hand live MATest setup to
   `matest-session`; use `browser-use` for Storybook or the prepared live
   surface.
4. For component parity, hand the canonical story pair and selectors to
   `path-component-parity`.
5. Compare equivalent screenshots and computed styles. Name each delta and
   trace it to the narrowest owner before editing.
6. Fix one owned delta, reload the real code path, and repeat the identical
   proof. Temporary browser overrides are experiment evidence only.
7. Capture final screenshots and verification. Record the result through the
   repository's parity ledger or tracker when one exists; otherwise include a
   bounded evidence summary in the handoff.

## Next Safe Action

With no arguments, inspect the current Figma URL and live surface, classify
page versus component ownership, then choose one reference pair to prove.
