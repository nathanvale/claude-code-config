# Docs Pattern

Use this when a Storybook component Docs page needs a complete top-to-bottom
structure.

This page owns docs composition. `references/ux-guidance.md` owns how to craft
UX guidance stories. `references/matrix-story-pattern.md` owns matrix
mechanics. `references/component-docs-rollout.md` owns batch migration across
component story files. `references/docs-workflow-checklist.md` owns completion
proof after docs-page work.

## Research Anchors

- Storybook Autodocs generates docs from story metadata and uses a default
  template of title, description, primary story, controls, and stories.
- The `Primary` doc block renders the first story defined in the stories file.
- Controls are driven by story args and can be improved with argTypes for finite
  options.
- Storybook tags can include or exclude stories from docs, dev, and tests.
- Storybook docs call variant grids combo stories: useful for many variants, but
  still not a substitute for focused stories and tests.
- Interaction tests are valuable for meaningful flows; do not make every visual
  specimen an interaction test.
- In Storybook v10, the `Stories` doc block accepts `includePrimary={false}`;
  use it in custom Autodocs templates so `Default` powers `Primary` without
  repeating in the Stories list.

Sources:

- `https://storybook.js.org/docs/writing-docs/autodocs`
- `https://storybook.js.org/docs/writing-docs/doc-blocks`
- `https://storybook.js.org/docs/writing-stories`
- `https://storybook.js.org/docs/writing-stories/args`
- `https://storybook.js.org/docs/essentials/controls`
- `https://storybook.js.org/docs/writing-stories/tags`
- `https://storybook.js.org/docs/writing-tests/interaction-testing`

## Page Order

Required:

1. Component title from Storybook.
2. Component description: one sentence on purpose and correct use.
3. `Default` story: first export; simple single-instance controls playground.
4. Controls / args table: useful defaults and finite controls.
5. Story body: `Matrix`, `UxTips`, then focused stories when each earns its
   place.

Optional:

6. `Matrix` story: dense comparison only when side-by-side review beats isolated
   stories.
7. `UxTips` or usage-guidance story: practical UX guidance after the matrix
   when the component needs decision rules, not another specimen. Include a
   brief best-practice summary and a visible link to the authoritative source
   used for the guidance in `parameters.docs.description.story`, not inside the
   preview canvas.
8. MDX guidance: use only when Autodocs cannot express required narrative,
   examples, or multi-component context.
9. Subcomponents: use when the main component cannot be understood without
   related primitives.

## Required Story Set

Every component docs page should have:

- `Default`: first export, visible in Docs, and wired for Controls.
- Component description with product-domain context, consumer task, or Figma
  design link/node reference when available. Avoid generic descriptions that do
  not tell the reader where the component belongs.
- Custom Autodocs template: render `Primary`, `Controls`, then
  `Stories includePrimary={false}` so the Default story is not duplicated in the
  docs body.
- Shared docs container and guidance/stage helpers when the project already has
  them, or when a second component repeats the same docs frame.
- Focused public states: one story for each state a consumer needs to deep-link
  or test.
- Controls-ready args: serializable args for the props a consumer should
  explore.
- Story descriptions when names alone do not explain intended use.
- Focused story descriptions with product scenario, domain term, or Figma node
  ref when local evidence exists.
- Visible authoritative source links in every `UxTips` or usage-guidance story
  description.

Do not delete isolated stories because a guidance story or matrix exists.
Default lets users play; matrix compares; guidance teaches; isolated stories
link and test.

## Story Budget

Storybook defines stories as rendered component states, and Controls exists to
let users change args without new code. Do not use story count as the rule; use
story purpose.

For components with many permutations, keep the public story set small:

- `Default`: one controls-ready playground.
- `Matrix`: one compact comparison when variants, states, sizes, or content
  shapes need scanning.
- `UxTips`: one guidance story when usage rules need teaching.
- Focused stories: only direct links, code examples, test targets, decision
  rules, or edge-case guards.

Do not export every permutation. Push visual-only combinations into Matrix,
interactive prop exploration into Controls, and behavior proof into focused
stories with `play` functions.

If a story exists only to prove tooling or CSS loaded, it is not component
documentation. Move that proof to a package check, or hide it from docs/sidebar
with Storybook tags only when it still has test value.

`UxTips` canvas rule: Storybook already renders the story title and description.
Put UX guidance prose and the primary source link in
`parameters.docs.description.story`. Render only component examples inside the
story canvas.

`Matrix` canvas rule: Storybook already renders the matrix story title and
description. Keep the story title as `Matrix` so it does not repeat the parent
component name in the sidebar. Put the matrix explanation in
`parameters.docs.description.story`. Render only table sections inside the
matrix canvas.

## Optional Story Set

Add only when the component supports the axis:

- Variant stories: visual intent, tone, or semantic variant.
- Size stories: only when size materially changes layout, density, or hit area.
- State stories: disabled, loading, selected, pressed, error, success, empty,
  readonly, open, closed.
- Content-shape stories: icon, icon-only, long label, multiline content,
  overflow, empty content.
- Interaction story: keyboard, pointer, menu open/close, validation, async
  loading, selection, or disclosure flow.
- Accessibility story: only when semantics need explicit proof beyond the normal
  interaction story.
- Composition story: when the component is normally used with a sibling or
  parent pattern.

## Focused Story Decision

Do not create one story for every invariant by default. Add a focused story when
at least one of these is true:

- Consumer need: someone should deep-link to this state from docs, design
  review, QA, or implementation notes.
- Code need: the story shows source code that differs meaningfully from
  `Default`.
- Test need: the state has behavior worth proving with `play`, a11y checks, or
  visual regression.
- Decision need: the state explains when to use a variant, size, or composition.
- Edge need: the state protects an easy-to-break condition, such as loading,
  disabled, error, empty, long content, icon-only, overflow, or keyboard focus.

Skip a focused story when:

- Controls can demonstrate the state clearly.
- Matrix already covers the visual-only comparison and no direct link is needed.
- The story would only duplicate another story with different text.
- The invariant is an internal implementation detail, not a consumer-facing
  state.

## Matrix Decision

Add `Matrix` when at least two of these are true:

- The component has multiple visual variants across multiple states.
- Side-by-side comparison catches drift faster than separate stories.
- Reviewers need to compare size, intent, state, density, or content shape.
- The component has pseudo-state specimens that cannot be naturally interacted
  with in one story, such as hover, focus, or pressed.
- The component is a design-system primitive where visual regressions are common
  and expensive.

Do not add `Matrix` when:

- The component has only one meaningful appearance.
- The component is mostly layout, copy, or data composition.
- The component's value is a flow better shown by UX guidance or interaction
  story.
- The matrix would repeat isolated stories without improving comparison.
- The matrix would become a long vertical page instead of a compact comparison.

Examples:

- Button, ToggleButton, CheckboxItem, Snackbar variants: matrix usually helps.
- Text field, select, radio group: matrix helps when states, validation, and
  content shape are hard to scan separately.
- Container, layout shell, typography wrapper: matrix usually does not help.
- Complex page or workflow component: prefer guidance plus focused interaction
  stories; add matrix only for reusable visual sub-states.

## Tags And Ordering

- Critical don't: do not split docs-facing optional stories into sibling CSF
  files just to protect manifests unless the actual Docs route proves those
  sibling stories render in the Docs page. Left-nav visibility is not enough.
- Critical don't: do not import `DocsMatrix*` helpers into a manifest-facing
  primary story file and finish without a passing
  `pnpm --filter @packages/portal-ui check:agent-registry`. Story-level
  `!manifest` does not hide file-level imports from public import generation.
- Put `Default` first by export order so Storybook's `Primary` doc block is a
  controls-ready playground.
- Keep `Default` in Autodocs.
- Keep docs width and outer rhythm in one shared docs container so all component
  docs change together.
- Keep guidance structure visually consistent through shared story helpers;
  keep the product scenario story-local.
- Put `Matrix` after `Default`.
- Put `UxTips`, `UsageGuidance`, or similar prose-led guidance after `Matrix`
  when present.
- Keep `Matrix` in Autodocs only when it belongs in the docs learning path.
- Use `tags: ['!autodocs']` for audit-only matrices that should stay out of the
  Docs page.
- Use `tags: ['!test']` for combo or matrix stories that are visual docs only
  and should not run as interaction tests.
- Keep focused testable stories separate from visual combo stories.
- Treat split `*.matrix.stories.tsx` files as a docs-inclusion risk: Storybook
  may show the story in the sidebar while the component Docs page renders only
  the primary CSF file's Stories block. If the matrix is docs-facing, verify the
  actual Docs route and move the export into the primary story file or use an
  explicit docs inclusion pattern. If it is audit-only, tag it `!autodocs` and
  name the reason.

## Controls And Args

- Use component-level args for defaults shared by most stories.
- Make the first story consume args directly, such as
  `render: (args) => <Component {...args} />`, or use Storybook's default render
  when `component` is enough.
- Use story-level args for each focused state.
- Use argTypes options and select/radio controls for finite choices.
- Use boolean controls for states such as loading and disabled.
- Use text controls for labels and simple content.
- Use `parameters.controls.include` or per-arg `table.disable` to keep the
  playground focused on consumer-facing props.
- Keep required fields populated with safe values.
- Do not push complex JSX through serializable args unless the story has a clear
  mapping pattern.

## Verification

- Complete `references/docs-workflow-checklist.md` before final handoff.
- Run `preview-stories` for `Default`, `Matrix`, `UxTips` when present, and changed focused
  stories.
- Run `run-story-tests` with `a11y: true` for affected stories.
- Screenshot the actual Docs page route when Docs order, guidance placement, matrix
  clipping, or margins matter.
- Verify Docs order: description, Default playground, Controls, focused stories
  and Matrix/guidance when present.
- Verify `Default` remains the first docs sample.
- Verify `Matrix` keeps horizontal scroll and has enough outer margin when
  present.
