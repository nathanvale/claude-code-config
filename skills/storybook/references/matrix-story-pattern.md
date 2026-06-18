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
- Tag every `Matrix` story with `tags: ['!autodocs']` — see Autodocs below.

## Before Editing

1. Read the component props and current stories.
2. Identify review axes: variant, size, state, density, intent, or content
   shape.
3. Check existing matrix patterns, such as
   `packages/portal-ui/src/ui/Snackbar/Snackbar.stories.tsx`.
4. Call `get-storybook-story-instructions` when Storybook MCP is available.
5. Use `get-documentation` before relying on design-system component props.

## Autodocs And The Hero Problem

Storybook Autodocs renders the **first export by source order** as the hero canvas above
the props/controls table. Putting `Matrix` first causes two problems:

1. The hero canvas shows a full-bleed multi-state grid — not an interactive single-instance
   demo. The Controls table below it is useless.
2. The matrix appears twice: once as hero and again in the STORIES section.

**Fix: tag every Matrix story with `tags: ['!autodocs']`.**

```ts
export const Matrix: Story = {
  tags: ['!autodocs'],          // ← removes from Docs page; sidebar + direct URL still work
  parameters: { layout: 'fullscreen' },
  render: () => <ComponentMatrix />,
}
```

- `!autodocs` removes the story from the Docs tab entirely.
- The story remains accessible in the sidebar and at `iframe.html?id=<story-id>--matrix&viewMode=story`.
- The `Default` story (first export) becomes the hero — an interactive single component
  above the props table.

There is no `primary: true` prop or name-based override. Position is the only lever; tag
out `Matrix` rather than fighting ordering.

## Canonical Story File Structure

Follow this ordering in every portal-ui story file with a matrix:

```
// 1. Matrix helpers (import from story-helpers/matrix or inline if first use)
// 2. Meta (with docs.description.component = inline docs example text + Figma node ref)
// export default meta
// type Story = StoryObj<typeof meta>
// 3. Default story FIRST — becomes the Autodocs hero above the props table
// 4. Other individual stories
// 5. Matrix story LAST — tagged !autodocs; accessible via sidebar + direct URL
```

The `Matrix` export must:
- Set `tags: ['!autodocs']` — prevents hero collision on the Docs page.
- Set `parameters.layout: 'fullscreen'`.
- Set `parameters.docs.description.story` with a brief description and a full Figma URL
  (e.g. `Figma: https://www.figma.com/design/<fileKey>/...?node-id=<nodeId>.`).
- Set `args` with safe placeholder values (required fields must be present to satisfy the
  meta type — use `variant: 'info', children: ''` or similar).
- Use `render: () => <ComponentMatrix />` pointing at a local render helper.

The meta must:
- Set `tags: ['autodocs']`.
- Set `parameters.docs.description.component` with a one-sentence description and a full
  Figma URL (e.g. `Figma: https://www.figma.com/design/<fileKey>/...?node-id=<nodeId>.`).

Individual stories must each set `parameters.docs.description.story`.

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

## Shared Matrix Primitives

Projects often co-locate reusable matrix primitives as shared story helpers. Before writing
new inline helpers, check whether the project already has them:

```bash
grep -r "MatrixRow" packages/ --include="*.tsx" -l
```

If the project exposes shared primitives (e.g. `src/story-helpers/matrix.tsx`), import from
there instead of inlining. The file must **not** be exported from the package's public
`index.ts` — it is story infrastructure only.

### TypeScript contract

```tsx
// MatrixPage — outer flex column wrapper
function MatrixPage({ children }: { children: ReactNode }): JSX.Element

// MatrixRow — domain card: title header + horizontal scroll body
function MatrixRow({ title, children }: { title: string; children: ReactNode }): JSX.Element

// Col — labeled state column; width defaults to 200px, pass narrower/wider as needed
function Col({
  label,
  width,      // optional number, default 200; applied as inline minWidth
  children,
}: {
  label: string
  width?: number
  children: ReactNode
}): JSX.Element
```

Width guidance by component type:
- Select / SelectField: `width={240}`
- TextArea / TextField: `width={280}`
- RadioGroup: `width={220}`
- RadioButton / Checkbox (naturally-sized atoms): `width={160}`
- Default (unspecified): `200`

### Design rules

- One `MatrixRow` card per domain (e.g. "States", "Validation", "Card variant").
- One `Col` per state/variant — side by side horizontally.
- `overflow-x-auto` + `min-w-max` inner flex = scrolls horizontally, never wraps.
- Never pass a hardcoded width into an interactive story wrapper inside `Col` — let `w-full`
  fill the `Col` instead.

### Radix RadioGroup override

Radix `RadioGroup` primitive defaults to `grid gap-3` (vertical stack). When placing
`RadioButton` atoms inside a `MatrixRow`, override the layout on the wrapper:

```tsx
<RadioGroup
  value={val}
  onValueChange={setVal}
  className="flex flex-row items-start gap-6"
>
  <Col label="Unchecked">…</Col>
  <Col label="Selected">…</Col>
</RadioGroup>
```

## MatrixShell / MatrixRow Helpers

Use this exact layout structure for the portal-ui **table-style** matrix shell (rows =
states, right column = preview). This is a different pattern from the horizontal-scroll
`MatrixRow` above — use it for checkbox-type atoms where the label column is meaningful:

```tsx
function MatrixShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border-default bg-surface-raised w-full overflow-x-auto rounded-lg border">
      <div className="min-w-[480px]">
        <div className="border-border-default bg-table-header-bg grid grid-cols-[140px_1fr] border-b">
          <h3 className="text-table-header text-text-default px-4 py-3 font-semibold">
            {title}
          </h3>
          <div className="text-table-header text-text-secondary px-4 py-3 font-semibold">
            Preview
          </div>
        </div>
        {children}
      </div>
    </section>
  )
}

function MatrixRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-border-subtle grid grid-cols-[140px_1fr] border-b last:border-b-0">
      <div className="text-table-body text-text-default flex items-center p-4 font-medium">
        {label}
      </div>
      <div className="flex items-center p-4">{children}</div>
    </div>
  )
}
```

Wrap in `<div className="flex w-full max-w-screen-sm flex-col gap-8 p-2">` at the
render root. Source of truth: `packages/portal-ui/src/ui/Snackbar/Snackbar.stories.tsx`.

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
- Open `iframe.html?id=<story-id>--docs&viewMode=docs` to verify the Docs page
  hero is the `Default` story (not `Matrix`) and Matrix is absent from STORIES list.
- Open `iframe.html?id=<story-id>--matrix&viewMode=story` to verify Matrix still
  renders at its direct URL after adding `tags: ['!autodocs']`.
- Run `run-story-tests` with `a11y: true` for affected matrix stories when MCP
  is available.

## Next Safe Action

- No story exists: create the smallest `Matrix` story first.
- Existing story exists: add `Matrix`, preserve isolated stories, then preview
  and run focused tests.
