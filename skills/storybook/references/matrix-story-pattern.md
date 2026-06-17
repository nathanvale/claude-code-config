# Matrix Story Pattern

Use this when a component story needs a one-page matrix for visual review,
design-system audit, or Figma-style variant comparison.

Do not use matrix work as permission to change component runtime behavior. Edit
stories only unless the user asks for component implementation changes.

## When To Add One

- Add a matrix when side-by-side review catches drift faster than isolated
  stories.
- Keep isolated stories for permalinks, focused tests, and docs examples.
- If no story exists, create the smallest useful `Matrix` story first.
- If stories exist, add `Matrix` without deleting existing stories.
- Put `Matrix` before individual stories when practical so Autodocs opens with
  the scan view.

## Before Editing

1. Read the component props and current stories.
2. Identify review axes: variant, size, state, density, intent, or content
   shape.
3. Check existing matrix patterns, such as
   `packages/portal-ui/src/ui/Button/Button.stories.tsx`.
4. Call `get-storybook-story-instructions` when Storybook MCP is available.
5. Use `get-documentation` before relying on design-system component props.

## Matrix Shape

- Rows: use the most stable design-system axis, usually variant or intent.
- Columns: use the state or size axis reviewers compare.
- Labels: keep them short and consistent so text width does not hide visual
  drift.
- Examples: put icon, loading, long-label, overflow, or unusual content cases in
  a small final section.
- Layout: horizontal scroll is fine.
- Sizing: do not shrink controls below their designed size.
- Helpers: keep matrix helpers story-local until a second component repeats the
  same shape.

## State Specimens

- Render real component instances for default, selected, disabled, empty,
  loading, and error states.
- Use explicit class overrides only for visual pseudo-state specimens such as
  hover, focus, or pressed.
- Make state observable through role, text, visible label, or ARIA attributes.
- Use realistic labels and data.

## Verification

- Run the component's focused tests.
- Run package lint when story shape or imports change.
- Open the matrix story preview.
- Open `iframe.html?id=<story-id>--matrix&viewMode=story` when a pixel or
  screenshot check matters.
- Open `iframe.html?id=<story-id>--docs&viewMode=docs` when Autodocs ordering
  matters.
- Check that the docs page shows the matrix before the long list of isolated
  stories when the matrix is intended as the first review surface.
- Run `run-story-tests` with `a11y: true` for affected matrix stories when MCP
  is available.

## Next Safe Action

- No story exists: create the smallest `Matrix` story first.
- Existing story exists: add `Matrix`, preserve isolated stories, then preview
  and run focused tests.
