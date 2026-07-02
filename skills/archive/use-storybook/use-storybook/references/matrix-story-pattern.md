# Matrix Story Pattern

Use this when a component story needs a one-page matrix for visual review,
design-system audit, or Figma-style variant comparison.

Do not use matrix work as permission to change component runtime behavior. Edit
stories only unless the user asks for component implementation changes.

Use `references/docs-pattern.md#matrix-decision` before adding a matrix to a
component Docs page.

## Critical Don'ts

- Do not move a docs-facing `Matrix` into a sibling `*.matrix.stories.tsx` file
  unless the actual component Docs route proves that sibling story appears in
  the Docs page. Sidebar/nav visibility is not proof.
- Do not use `tags: ['!manifest']` as a Docs-page inclusion mechanism. It is a
  manifest signal, not a Docs block signal.
- Do not import shared `DocsMatrix*` helpers into a manifest-facing primary
  story file and finish without a passing
  `pnpm --filter @packages/portal-ui check:agent-registry`. If the registry
  fails, stop and report the manifest/docs pattern conflict instead of hiding
  the story in a sibling file.

## When To Add One

- Add a matrix when side-by-side review catches drift faster than isolated
  stories.
- Skip a matrix when the component has only one meaningful appearance or the
  value is better shown through UX guidance or an interaction story.
- Keep isolated stories for permalinks, focused tests, and docs examples.
- If no story exists, create the smallest useful `Matrix` story first.
- If stories exist, add `Matrix` without deleting existing stories.
- Tag standalone audit matrices with `tags: ['!autodocs']` — see Autodocs
  below.

## Before Editing

1. Read the component props and current stories.
2. Identify review axes: variant, size, state, density, intent, or content
   shape.
3. Check existing matrix patterns in the target project, e.g. (where present)
   `packages/portal-ui/src/ui/Snackbar/Snackbar.stories.tsx`.
4. Call `get-storybook-story-instructions` when Storybook MCP is available.
5. Use `get-documentation` before relying on design-system component props.

## Autodocs And The Primary Playground

Storybook Autodocs renders the **first export by source order** in the Primary
doc block above the props/controls table. Putting `Matrix` first causes two
problems:

1. The hero canvas shows a full-bleed multi-state grid — not an interactive single-instance
   demo. The Controls table below it is useless.
2. The matrix appears twice: once as hero and again in the STORIES section.

For standalone audit matrices, tag `Matrix` with `tags: ['!autodocs']`.

```ts
export const Matrix: Story = {
  tags: ['!autodocs'],          // ← removes from Docs page; sidebar + direct URL still work
  parameters: { layout: 'fullscreen' },
  render: () => <ComponentMatrix />,
}
```

- `!autodocs` removes the story from the Docs tab entirely.
- The story remains accessible in the sidebar and at `iframe.html?id=<story-id>--matrix&viewMode=story`.
- The `Default` story (first export) becomes the Primary docs sample: an
  interactive single component above the props table.

There is no `primary: true` prop or name-based override. Position is the only lever; tag
out `Matrix` rather than fighting ordering.

For Docs pages with UX guidance, do not tag `Matrix` out when the matrix belongs
in the learning path. Use `references/ux-guidance.md`: put `Default` first,
then render `Matrix`, then `UxTips` or equivalent guidance underneath.

## Canonical Story File Structure

Follow this ordering in every portal-ui story file with a matrix:

```ts
// 1. Matrix helpers (manifest-safe only; do not leak story-only helper imports)
// 2. Meta (with docs.description.component = inline docs example text + Figma node ref)
// export default meta
// type Story = StoryObj<typeof meta>
// 3. Default story FIRST — becomes the Autodocs Primary sample above the props table
// 4. Other individual stories
// 5. Matrix story LAST — tag !autodocs only when it should stay out of Docs
```

The `Matrix` export must:

- Set `tags: ['!autodocs']` only for standalone audit matrices that should stay
  out of the Docs page.
- Prefer the export name `Matrix` as the visible Storybook title. The component
  name is already present in the sidebar and docs hierarchy, so avoid names like
  `Button state matrix` that repeat the parent component.
- Set `parameters.layout: 'fullscreen'`.
- Set `parameters.docs.description.story` with the matrix explanation. Storybook
  owns the visible story heading and description; do not render another matrix
  title or description inside the canvas.
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
rg "DocsMatrixShell|MatrixRow" packages/ --glob "*.tsx"
```

If the project exposes shared primitives (e.g. `src/story-helpers/matrix.tsx`), import from
there instead of inlining. The file must **not** be exported from the package's public
`index.ts` — it is story infrastructure only.

For portal-ui docs matrices, treat
`packages/portal-ui/src/story-helpers/matrix.tsx` as the visual contract. Use
`DocsMatrixShell` for the outer framed section and `DocsMatrixTable`,
`DocsMatrixRow`, and `DocsMatrixCell` for the table sections. The helper owns
the matrix canvas wrapper, horizontal scrolling, and table rhythm; stories own
only the Storybook story name, description, and component specimens inside each
cell.
Do not put a custom matrix title, description, eyebrow, or source link inside
the matrix canvas. Storybook already renders the story heading and description
above the canvas.

Call `DocsMatrixShell` around only the table sections:

```tsx
<DocsMatrixShell>
  <DocsMatrixTable title="Variant" columns={["Default", "Hover", "Focus"]}>
    <DocsMatrixRow label="Primary" columns={3}>
      <DocsMatrixCell>{/* real component specimen */}</DocsMatrixCell>
    </DocsMatrixRow>
  </DocsMatrixTable>
</DocsMatrixShell>
```

Put that fixed copy on the story instead:

```tsx
export const Matrix: Story = {
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "Review intent, state, size, and content variants in one compact grid.",
      },
    },
  },
  render: () => <ButtonMatrix />,
};
```

Keep each table header and specimen row on the same optical horizontal gutter;
preserve row vertical padding for the component specimens instead of forcing it
to match Storybook heading rhythm.
Apply that gutter to the first column cells, not to the scrollable grid wrapper;
wrapper padding becomes visible as blank space when the user scrolls right.

When a specimen is wider than the default comparison cells, widen that table
instead of letting content overflow:

```tsx
<DocsMatrixTable
  title="Example"
  columns={["Icon", "Loading", "Long label"]}
  columnMinWidth={360}
>
  {/* rows */}
</DocsMatrixTable>
```

Use this for long-label, icon-plus-label, loading, or composed examples where
the component's natural width matters. The header and every row share the same
column width through the helper, so horizontal scroll reaches the full content
instead of clipping the table grid early.

### TypeScript contract

```tsx
// MatrixPage — outer flex column wrapper
function MatrixPage({ children }: { children: ReactNode }): JSX.Element;

// MatrixRow — domain card: title header + horizontal scroll body
function MatrixRow({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element;

// Col — labeled state column; width defaults to 200px, pass narrower/wider as needed
function Col({
  label,
  width, // optional number, default 200; applied as inline minWidth
  children,
}: {
  label: string;
  width?: number;
  children: ReactNode;
}): JSX.Element;
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

## Legacy MatrixShell / MatrixRow Helpers

Use the shared `DocsMatrix*` helpers above for new portal-ui table-style docs
matrices. Only inline the older shape below when the project does not yet have
the helper and the matrix has a simple rows-to-preview layout:

```tsx
function MatrixShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
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
  );
}

function MatrixRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border-subtle grid grid-cols-[140px_1fr] border-b last:border-b-0">
      <div className="text-table-body text-text-default flex items-center p-4 font-medium">
        {label}
      </div>
      <div className="flex items-center p-4">{children}</div>
    </div>
  );
}
```

Wrap in `<div className="flex w-full max-w-screen-sm flex-col gap-8 p-2">` at the
render root. For a worked example, see a matrix story in the target project, e.g.
(where present) `packages/portal-ui/src/ui/Snackbar/Snackbar.stories.tsx`.

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
