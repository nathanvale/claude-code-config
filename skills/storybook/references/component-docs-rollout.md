# Component Docs Rollout

Use this when applying the hardened Autodocs pattern across multiple component
story files.

The Button story is the canonical local example. Treat it as an implementation
reference, not a copy source for component-specific content.

## Target State

Every migrated component docs page should have:

- Shared Autodocs template from Storybook preview.
- Shared docs container/helper owning width and docs card rhythm.
- `Default` first, wired to Controls.
- Product-domain context or Figma design link/node reference in component
  descriptions when available; focused stories keep relevant node refs when they
  explain state provenance.
- Component-level `@summary` above the exported runtime component, because summaries on
  `Props` do not populate Storybook AI manifests.
- `Stories includePrimary={false}` in the custom Autodocs template so `Default`
  powers the top `Primary` block without repeating in the Stories list.
- Focused stories only when they earn a direct link, code example, test target,
  decision rule, or edge-case guard.
- `Matrix` only when side-by-side visual comparison earns its place.
- `Matrix` uses `!manifest` when it is a visual audit rather than an agent usage example.
- If Matrix imports shared story helpers, either put Matrix in a separate
  `*.matrix.stories.tsx` file with meta `tags: ['!manifest']`, or keep helpers local so
  Storybook's generated public import block stays clean.
- `Matrix` stays named `Matrix` in the sidebar, and
  `parameters.docs.description.story` owns the matrix explanation. The canvas
  renders table sections only.
- `UxTips` or equivalent guidance only when the component has usage decisions
  worth teaching.
- Every `UxTips` story includes a brief best-practice summary and a visible link
  to one primary authoritative source in `parameters.docs.description.story`.
- `UxTips` canvases render component examples only. Do not render an extra
  guidance card, title, description, footer prose, or source link inside the
  canvas.

Portal-ui owner paths:

- Custom Autodocs template:
  `packages/portal-ui/.storybook/PortalDocsPage.tsx`
- Shared docs width, card, header, and guidance helpers:
  `packages/portal-ui/src/story-helpers/docs.tsx`
- Shared matrix helpers:
  `packages/portal-ui/src/story-helpers/matrix.tsx`
- Canonical component example:
  `packages/portal-ui/src/ui/Button/Button.stories.tsx`

## Batch Strategy

Do not migrate the whole library in one edit. Move in small batches:

1. One high-confidence primitive with simple props.
2. One visual primitive with meaningful variants.
3. One form/input component with validation or interaction states.
4. Review the pattern before expanding to larger batches.

After each batch, run focused story tests and screenshot at least one Docs page.

## Component Audit

Before editing a component story, gather:

- Component props and exported types.
- Existing stories and story order.
- Existing matrix, combo, or usage examples.
- Existing play functions and a11y checks.
- Storybook title and taxonomy folder.
- Existing product-domain terms, Figma links, Figma node refs, and design-system
  notes already present near the component.
- Consumer-facing axes: variant, size, state, content shape, interaction,
  composition.
- Figma/design-system reference when already present.

## Decision Gates

Default gate:

- Always create or keep `Default` first.
- Use serializable args for common consumer-facing props.
- Use finite controls for variants, sizes, and states.
- Hide props that are internal, complex JSX-only, or not useful in the
  playground.

Focused story gate:

- Keep a story when it is a direct link, code example, test target, decision
  rule, or edge-case guard.
- Delete or merge a story only when Controls or Matrix covers it and it has no
  direct-link/test/code value.
- Preserve existing play functions unless replacing them with stronger coverage.
- Remove public stories that only prove Storybook setup or CSS loading. Move
  that proof to verification, or hide it from docs/sidebar with tags only when
  the story still has test value.

Matrix gate:

- Add or keep Matrix when visual comparison beats isolated stories.
- Put Matrix after Default.
- Use shared `DocsMatrix*` helpers when available.
- Keep Matrix in Autodocs when it belongs in the docs learning path.
- Tag Matrix `!autodocs` only for audit-only matrices.

UX guidance gate:

- Add `UxTips` only when the component has usage rules, hierarchy decisions,
  variant-selection rules, or do/don't guidance.
- Put UX guidance after Matrix when both exist.
- Make the guidance story canvas product-like and component-specific, but keep
  it component-only.
- Put the guidance prose and one visible primary source link in
  `parameters.docs.description.story`. Prefer W3C WAI-ARIA APG, WCAG, MDN,
  platform design docs, or official design-system docs over generic UX blogs.

## Copyable Prompt

Use this prompt for one component at a time. Replace bracketed values before
running it.

```text
Use the Storybook skill.

Target repo: [absolute repo path]
Target component story: [absolute path to Component.stories.tsx]
Canonical example: packages/portal-ui/src/ui/Button/Button.stories.tsx

Goal:
Migrate this component story to the hardened portal-ui Autodocs pattern.

Required reading before edits:
- skills/storybook/references/docs-pattern.md
- skills/storybook/references/component-docs-rollout.md
- skills/storybook/references/docs-workflow-checklist.md
- skills/storybook/references/matrix-story-pattern.md when Matrix is present or likely
- skills/storybook/references/ux-guidance.md when UX tips are present or likely

Rules:
- Preserve runtime component behavior.
- Preserve unrelated user changes.
- Use shared docs helpers instead of inline docs width/card/header styling.
- Put `@summary` above the exported component; a props-interface summary is not enough
  for AI manifests.
- In portal-ui, use DocsContainer, DocsStoryStage, DocsMatrixShell,
  DocsMatrixTable, DocsMatrixRow, and DocsMatrixCell when they fit.
- Keep Default first and Controls-ready.
- Do not duplicate Default in the Docs body; rely on the custom Autodocs template using Stories includePrimary={false}.
- Do not create one story for every invariant.
- Keep focused stories only when they provide a direct link, code example, test target, decision rule, or edge-case guard.
- Add Matrix only when side-by-side visual comparison earns it.
- Keep Matrix out of AI manifests unless it is a realistic usage example.
- Add UxTips only when usage guidance earns it.
- Every UxTips story must include a short best-practice summary and one visible authoritative source link in `parameters.docs.description.story`.
- UxTips canvases must render component examples only; do not put guidance prose, source text, or source links inside the canvas.
- Use realistic labels and data.
- Keep play functions meaningful and inspectable by role/text/ARIA.

Deliver:
- Patch the story file and shared story helpers only if needed.
- List the story-set decision: Default, focused stories kept/removed, Matrix yes/no, UxTips yes/no.
- Run focused TypeScript, lint or formatting, and story tests for the touched story.
- Run `pnpm --filter @packages/portal-ui check:agent-registry` after manifest-facing
  changes.
- Screenshot the Docs page when order, width, Matrix, or UxTips changed.
- Complete and return the docs workflow checklist.
```

## Output Contract

Each migrated component handoff should report:

- Component story path.
- Story order after migration.
- Controls exposed and hidden.
- Focused stories kept and why.
- Matrix decision and why.
- UX guidance decision and why.
- UX guidance source link when guidance is present.
- Shared helper changes, if any.
- Verification commands and results.
- Screenshot path or preview URL when visual docs changed.
- Completed docs workflow checklist.

## Verification

For each batch:

- Type-check the affected package.
- Run focused Storybook story tests for touched stories.
- Run lint or formatter on touched files.
- Build Storybook after changing the custom Autodocs template or shared docs
  helpers.
- Screenshot at least one representative Docs page.
- Confirm `Default` appears only as the top Primary playground, not repeated in
  the Stories list.
- Confirm shared docs width comes from the shared docs container.
- Complete `references/docs-workflow-checklist.md` and include it in the handoff.
