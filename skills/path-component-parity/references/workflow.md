# Path Component Parity Workflow

## Inputs

- Path Storybook story id.
- Canonical portal-ui story id.
- Variant selector spec for default, hover, focus, pressed, and disabled states.
- Explicit viewport and device scale factor shared by both stories.

Inspect Storybook and the component coverage owner before asking for missing
selectors. Stop when multiple canonical counterparts remain plausible.

## Measure

1. Start the portal-ui Storybook.
2. Choose one run id and mint a verified browser handoff:

   ```sh
   browser-connect connect chrome-devtools-mcp --json --run-id <run-id> > <handoff.json>
   ```

3. Read `skills/browser-use/SKILL.md`. Open both story iframe targets through
   its verified target workflow. Never guess a CDP port.
4. Read current driver help:

   ```sh
   bun skills/path-component-parity/scripts/measure-computed.mjs --help
   ```

5. Run the driver with the handoff, both story ids, and a selector spec. The
   output contains one variant by state by property delta table plus raw JSON
   evidence.
6. Capture both matrices through `browser-use` with identical viewport and
   device scale factor.

The canonical matrix uses static state classes in dedicated cells. Point each
reference state at its dedicated cell. Let the driver force Path pseudo-states,
unless the selector spec names a static Path state cell.

For item-bearing overlays, open Portal UI and Path sequentially. Require paired
visible specimens and settled captures for default, hover, held pointer press,
keyboard focus, selected, disabled, and destructive item states when supported.
Bind each overlay to its trigger through the component's ARIA relationship. A
closed trigger or open popup without item-state evidence is incomplete.

## Read Pseudo-State Evidence

`CSS.forcePseudoState` can leave Emotion hover or focus-visible paint unchanged
in computed output. The driver records matching pseudo-rule selectors, rule
text, and declarations in the JSON evidence.

- Compare computed values first.
- When forced output reads `none` or stays at the default value, inspect the
  matched pseudo-rule evidence.
- Treat the winning matched rule as the byte-accurate style source.
- Keep reference and Path screenshots on the same viewport and scale before
  judging ring geometry or gaps.

## Fix

1. Trace each mismatch to the narrowest owned Path seam.
2. Edit global component styling in
   `packages/portal-ui/src/path-theme/component-overrides.ts`.
3. Edit shared Path token mappings in
   `packages/portal-ui/src/path-theme/path-theme-token-map.ts` only when the
   mismatch is token-owned.
4. If the vendor component ignores a supported prop, add a small adapter under
   `packages/portal-ui/src/path-theme/runtime/adapters/`. Follow
   `ButtonAdapter.jsx`: restore only the missing treatment through `sx`.
5. Regenerate through the owner command:

   ```sh
   pnpm -C packages/portal-ui exec build-tokens --json
   ```

6. Never edit
   `packages/portal-ui/theme/generated-path-theme-options.json` directly. The
   token build owns it.
7. Rerun the identical measurement until every supported delta matches.

## Story And Test Evidence

- Add or extend a Path parity matrix in
  `packages/portal-ui/src/path-theme/PathTheme*.stories.jsx`.
- Mirror the canonical `DocsMatrix*` layout from
  `packages/portal-ui/src/story-helpers/matrix.tsx`.
- Add a Storybook `play` test for the measured values.
- Keep structural behavior outside theme CSS. Use an adapter only when the
  vendor surface cannot express the canonical contract.

## Owners

| Concern | Owner |
| --- | --- |
| Path component coverage | `packages/portal-ui/src/path-theme/component-coverage.ts` |
| Global MUI overrides | `packages/portal-ui/src/path-theme/component-overrides.ts` |
| Path token mapping | `packages/portal-ui/src/path-theme/path-theme-token-map.ts` |
| Theme generator | `packages/portal-ui/tools/design-tokens/src/build-tokens-cli.ts` |
| Generated artifact | `packages/portal-ui/theme/generated-path-theme-options.json` |
| Runtime adapters | `packages/portal-ui/src/path-theme/runtime/adapters/` |
| Path story evidence | `packages/portal-ui/src/path-theme/PathTheme*.stories.jsx` |
| Matrix layout | `packages/portal-ui/src/story-helpers/matrix.tsx` |
| Theme guardrail | `packages/portal-ui/src/__tests__/experience/ellucianPathTheme.test.tsx` |
| Measurement contract | `skills/path-component-parity/scripts/measure-computed.mjs` |

## Verify

Run focused checks after source changes:

```sh
bun test skills/path-component-parity/scripts/measure-computed.test.mjs
pnpm -C packages/portal-ui exec build-tokens --check --json
pnpm --filter @packages/portal-ui test
```

Run package-owned Path-only and vendor-theme checks named by the current plan or
component evidence. Do not invent stale fallback commands.

## Next Safe Action

- Deltas remain: fix the named owner and repeat the same measurement.
- Matched rule and computed output disagree: inspect cascade ownership before
  editing.
- Theme overrides cannot express structure: prove the ignored prop, then add
  the smallest adapter.
- Zero deltas: run verification, archive evidence, then choose the next mapped
  component.
