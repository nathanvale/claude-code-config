# UX Best Tips Pattern

Use this when a Storybook Docs page needs a polished UX best-practice guidance
story that teaches how to use the component well in a real product moment.

This pattern replaces the older hero pattern. Treat it as UX guidance, not a
top-of-page hero.

The guidance story is not the Storybook `Primary` playground. The first export
should stay a simple `Default` story wired to Controls. Use this pattern lower
in Docs for a compact best-practice summary that teaches how the component
behaves in context after the reader has a controllable default specimen.

Use `references/docs-pattern.md` for the full page order and required-and-optional
story set. Use `references/docs-workflow-checklist.md` for final completion
proof after adding or changing UX guidance.

## Placement

The `Default` export comes first by source order after `export default meta`.
`Matrix`, when useful, comes after `Default`. Put UX guidance after `Matrix`
when the guidance is prose-led or best-practice-led.

Recommended Docs order:

1. `Default`: one component instance controlled by Storybook Controls.
2. `Matrix`: dense comparison of meaningful states and variants.
3. `UxTips`: best-practice guidance in the Storybook story description, with
   the canvas rendering only component examples.

## UX Source Route

Start with local truth, then widen to authoritative UX, accessibility, platform,
and design-system sources. Extract principles; do not copy prose, layout, or
component API contracts from external sites.

Choose one primary guidance source for each `UxTips` story. Use other sources
for research, but cite the single source that best owns the guidance claim.

Primary source hierarchy:

1. Local component/design-system guidance when it exists and is current.
2. W3C WAI-ARIA APG, WCAG, or MDN for semantics, roles, states, keyboard
   behavior, and accessibility claims.
3. Official platform or design-system guidance such as Apple HIG, Material
   Design, GOV.UK Design System, Microsoft Fluent, or Red Hat UX.
4. Nielsen Norman Group for broad usability principles and state communication.
5. Community posts, videos, Dribbble, and screenshots as inspiration only; do
   not cite them as the primary source.

Research order:

1. Read the local component docs, Figma notes, and existing Storybook stories.
2. Check the target design system's component guidance when it exists.
3. Use official or authoritative sources for behavior principles:
   - W3C WAI-ARIA APG, WCAG, and MDN for semantics, roles, states, and keyboard
     behavior.
   - Platform guidance such as Apple HIG, Material Design, GOV.UK Design
     System, or Microsoft Fluent for interaction and component usage guidance.
   - Nielsen Norman Group for usability principles and state communication.
4. For accessibility claims, route through
   `references/accessibility-source-route.md`; do not rely on UX blogs.
5. Treat community posts, videos, Dribbble, and screenshots as inspiration only.

Button example source call:

```text
firecrawl_search:
  query: "button UX best practices design system primary secondary destructive button Nielsen Norman Group Material Design GOV.UK Apple Human Interface Guidelines"
  limit: 6
  sources: [{ type: "web" }]
```

Good Button source targets:

- Apple HIG Buttons:
  `https://developer.apple.com/design/human-interface-guidelines/buttons`
- NN/g button states:
  `https://www.nngroup.com/articles/button-states-communicate-interaction/`
- Red Hat Button guidelines:
  `https://ux.redhat.com/elements/button/guidelines/`
- Public Storybook design-system examples:
  `https://storybook.js.org/blog/4-ways-to-document-your-design-system-with-storybook/`
  and `https://nypl.github.io/nypl-design-system/reservoir/v1/?path=/docs/style-guide-buttons--docs`

Map research into this docs model:

- `Default` and Controls: code reference and playable single specimen.
- `Matrix`: live examples for variants, states, sizes, and content shapes.
- `UxTips`: usage guidelines and decision heuristics in
  `parameters.docs.description.story`; component examples only in the canvas.
- Focused stories: direct links and test targets for states consumers need.

Button guidance should usually resolve to a few product rules:

- Use one visually dominant primary action per decision surface.
- Keep secondary and text actions close enough to compare.
- Separate destructive actions from the main decision path.
- Show loading, disabled, focus, hover, and pressed states where they clarify
  user feedback.
- Use concrete labels that name the action outcome.

Every UX guidance story must include one visible primary source link in the
Storybook story description:

- Put a short summary in `parameters.docs.description.story`.
- Link to the primary guidance source chosen from the source hierarchy.
- Prefer official accessibility or platform sources over generic blog posts.
- Label the link plainly, such as `WAI-ARIA APG Button Pattern` or
  `Apple HIG Buttons`.
- If guidance combines several sources, link the source that justifies the
  riskiest or least obvious claim.
- Do not put UX prose, source text, or source links inside the story canvas.

## Frontend-Design Companion

When the user asks for look, feel, guidance quality, visual critique, or polish, use
the frontend-design skill before authoring the guidance story.

Write three short planning lines before code:

- Visual thesis: how the existing design system should feel in this guidance
  example.
- Content plan: what workflow or UX best-practice moment the story depicts and
  which variants it reveals.
- Interaction plan: which visible action or state the play function proves.

In an existing component library, inherit tokens, radius, typography, and
spacing. Do not introduce a new visual language for one docs page.

## Craft

Build the guidance story like a miniature product moment:

- Use one specific scenario, such as review queue, upload flow, filter builder,
  approval decision, empty state recovery, or form validation.
- Show the component's meaningful variants through the scenario, not as a loose
  specimen pile.
- Give the primary variant the main job.
- Use secondary/text variants for support actions.
- Place destructive, loading, disabled, or error states where a user would
  expect them in that workflow.
- Keep copy product-like and concrete.
- Use the existing design system's spacing, radius, typography, icon set, and
  color tokens.
- Keep the story canvas component-only: buttons, toggles, fields, status
  examples, or composed product snippets. Do not add an extra guidance title,
  description, footer prose, or source link inside the canvas.
- Add a `play` function that proves the critical visible actions exist or work.

## Shared Guidance Primitives

Make the deterministic part shared. Keep the creative part local.

Before writing an inline guidance layout, check the target project for story helpers,
such as `src/story-helpers/docs.tsx` or `src/story-helpers/matrix.tsx`.

The shared docs container owns width. Do not put `max-w-*`, outer margin, card
surface, or docs-stage padding in each component story when a shared docs
container exists. Changing documentation width should be one helper edit.

Use or create shared canvas helpers when:

- A project already has a docs stage or docs container helper.
- A second component repeats the same preview alignment or component grouping.
- Docs-page screenshots show inconsistent guidance margins between components.

Keep these in shared helpers:

- Docs canvas stage and outer margin.
- Docs container width token or class.
- Action alignment primitives when repeated examples need the same rhythm.

Keep these story-local:

- Scenario, data, and labels.
- Story description prose and primary source link.
- Component layout and action arrangement inside the canvas.
- Which component variants appear.
- Which icons appear.
- Which actions are primary, secondary, text, destructive, loading, or disabled.
- `play` assertions.

For portal-ui docs guidance stories, do not render a custom guidance header,
description, source footer, or source link inside the canvas. Storybook already
renders the story name and story description above the canvas.

Example story shape:

```tsx
function ComponentUsageGuidanceExample() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary">Approve selected</Button>
      <Button variant="secondary">Request changes</Button>
      <Button variant="text">Cancel</Button>
      <Button variant="destructive-secondary" size="small">
        Reject selected
      </Button>
    </div>
  );
}

export const UxTips: Story = {
  name: "UX tips",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        story:
          "Button decisions should stay obvious. Use one primary action per decision surface, keep secondary choices close, and separate destructive actions from the main path. Source: [Red Hat Button guidelines](https://ux.redhat.com/elements/button/guidelines/).",
      },
    },
  },
  render: () => <ComponentUsageGuidanceExample />,
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /approve selected/i }),
    ).toBeInTheDocument();
  },
};
```

## Matrix Follow-On

The matrix is a dense comparison sample. It exists to compare variants, sizes,
states, or content shapes after the default playground has shown a live
single-instance component.

- Put `Matrix` after `Default`.
- Put `UxTips` or similar guidance after `Matrix` when present.
- Add `Matrix` only when `references/docs-pattern.md#matrix-decision` says it
  earns its place.
- Keep horizontal scrolling when width would otherwise force a long vertical
  page.
- Set `parameters.layout: 'fullscreen'` when Autodocs clips a centered matrix.
- Wrap the matrix in a full-width stage with docs-canvas breathing room.
- Keep row labels and section headings visible without horizontal scroll.
- Let only the dense matrix body scroll horizontally.
- Add examples for icon, loading, long label, overflow, or unusual content
  shapes in a final section.

```tsx
function ComponentMatrixExample() {
  return (
    <div className="flex w-full justify-center p-6">
      <ComponentMatrix />
    </div>
  );
}

export const Matrix: Story = {
  parameters: { layout: "fullscreen" },
  render: () => <ComponentMatrixExample />,
};
```

Use `tags: ['!autodocs']` only for a standalone audit matrix that should stay out
of the Docs page. Do not tag out a matrix when the user asks for a docs page
with the matrix in the learning path.

## Shared Story Helpers

Keep guidance and matrix helpers story-local for the first component unless the
target project already has matching helpers.

Extract shared story helpers when a second component repeats the same shape:

- Put helper code under the target project's story-helper folder, not the public
  package API.
- Keep helpers presentational: shell, stage, row, cell, heading, and margin.
- Keep component-specific content in the story file.
- Use names that describe docs infrastructure, such as `DocsContainer`,
  `DocsStoryStage`, `DocsMatrixShell`, `DocsMatrixRow`, or `DocsMatrixCell`.
- Do not export story helpers from package `index.ts`.

Good split:

- Shared helper owns docs width, preview alignment, matrix scroll stage, and
  repeated row/cell structure.
- Story file owns variants, labels, actions, examples, args, and play functions.

## Verification

- Complete `references/docs-workflow-checklist.md` before final handoff.
- Preview the `Default`, `Matrix`, and guidance stories.
- Run focused `run-story-tests` with `a11y: true` when MCP is available.
- Screenshot the actual Docs page route, not only
  `iframe.html?id=<story-id>--matrix&viewMode=story`.
- Check the Docs page at the matrix anchor or by scrolling to the Matrix heading.
- Verify `Default` remains the top sample and the matrix/guidance stories appear
  underneath.
- Verify the matrix has enough outer margin and keeps horizontal scroll.
