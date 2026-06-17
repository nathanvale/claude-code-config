# Story Authoring Loop

Use this when editing `*.stories.*` files or adding story coverage for a changed
component.

## Before Editing

1. Read the component props and existing stories.
2. Call `get-storybook-story-instructions`.
3. Identify the review axes: variant, size, state, density, content shape, or
   interaction.
4. Keep isolated stories for permalinkable states.
5. Add a matrix only when side-by-side review reduces visual ambiguity.
6. Read `references/matrix-story-pattern.md` before adding a matrix story.
7. Read `references/accessibility-source-route.md` when accessibility behavior,
   source authority, or checklist coverage affects the story.

## Story Shape

Use real component instances for default, selected, disabled, empty, loading,
and error states.

Use explicit class overrides only for pseudo-state specimens such as hover,
focus, or pressed.

Use realistic labels and data. Make state observable through role, text, or ARIA
attributes.

For interactive components, add at least one `play` function that proves the
main keyboard or pointer path.

Use `storybook/test` imports for `expect`, `userEvent`, `within`, `screen`, or
`fn`.

Type stories with `StoryObj<typeof meta>` when adding `play` functions.

## After Editing

1. Format the touched story file.
2. Call `preview-stories` for affected stories.
3. Call `run-story-tests` with focused story IDs and `a11y: true`.
4. Route accessibility findings through
   `references/accessibility-source-route.md`.
5. Fix semantic failures.
6. Ask before visual changes from a11y output.
7. Return links and the test result.

## Good Focused Test Targets

- Default story: one happy-path interaction.
- Matrix story: render and accessibility smoke.
- Error story: invalid state is announced.
- Disabled story: control cannot be activated.
- Keyboard story: focus, arrow, enter, escape, or tab path works.
- Accessibility story: name, role, value, focus, keyboard path, reduced motion,
  and visible error or status semantics are observable.

## Avoid

- Story-only states that cannot be inspected by role, text, or ARIA.
- Giant story files that duplicate production logic.
- Matrix cells narrower than the actual component.
- Deleting isolated stories when adding a matrix.
- Running all story tests while iterating on one component.
