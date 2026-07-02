---
name: storybook-matrix
description: "Create Storybook matrix stories for component variants, sizes, states, or docs-page review surfaces."
role: tool-workflow
---

# Storybook Matrix

Use when a component story needs a one-page matrix for visual review, design-system
audit, or Figma-style variant comparison.

Do not use for component runtime behavior. Edit stories only unless the user asks for
component implementation changes.

## Owner Paths

- Pattern: `packages/portal-ui/src/ui/Button/Button.stories.tsx`.
- Component source: nearest `*.tsx` component file.
- Story source: nearest `*.stories.tsx` file.
- Storybook config: `packages/portal-ui/.storybook/`.

## Workflow

1. Read the component props and current stories.
2. Identify review axes: variant, size, state, density, intent, or content shape.
3. Keep isolated stories for permalinks and focused tests.
4. Add one `Matrix` story before individual stories so Autodocs opens with the scan view.
5. Render real component instances for default and disabled states.
6. Use explicit class overrides only for visual pseudo-state specimens like hover, focus, or pressed.
7. Keep matrix helpers story-local until a second component repeats the same shape.
8. Screenshot the matrix story and docs iframe.

## Matrix Shape

- Rows: the most stable design-system axis, usually variant or intent.
- Columns: the state or size axis reviewers compare.
- Labels: short and consistent so text width does not hide visual drift.
- Examples: put icon, loading, and long-label cases in a small final section.
- Layout: horizontal scroll is fine; avoid shrinking controls below their designed size.

## Verification

- Run the component's focused tests.
- Run package lint.
- Open `iframe.html?id=<story-id>--matrix&viewMode=story`.
- Open `iframe.html?id=<story-id>--docs&viewMode=docs`.
- Check that the docs page shows the matrix before the long list of isolated stories.

## Next Safe Action

- If no story exists, create the smallest `Matrix` story first.
- If a story exists, add `Matrix` without deleting existing stories.
