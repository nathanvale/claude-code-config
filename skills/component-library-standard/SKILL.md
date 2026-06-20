---
name: component-library-standard
description: "Audit, fix, or scaffold React component library files for JSDoc, props structure, forwardRef, displayName, barrel exports, and controlled/uncontrolled patterns. Use when writing, reviewing, or fixing component library code."
---

# Component Library Standard

Enforce 5 core practices on React/TypeScript component library files.
Works as a standalone audit or as a lens inside a workflow.

## Intent Classification

| Signal | Route |
|--------|-------|
| No args | **Show audit menu** (see below) |
| "summary" / "JSDoc cleanup" / "registry" / "agent manifest" | JSDoc-only cleanup mode |
| "inline comments" / "comment cleanup" / "remove dividers" | Inline-comment cleanup mode |
| File path or component name | Audit that component against the 5 practices |
| "scaffold" / "new component" / "template" | Generate a new component from the template |
| "fix" / "heal" + file path | Fix violations in-place |
| "audit" / "check" + directory | Audit all components in directory, return findings |

### No-args menu

> **Component Library Standard — pick an action:**
>
> 1. **Audit a component** — name a file or component to check against the 5 practices.
> 2. Clean JSDoc summaries — use JSDoc-only cleanup mode.
> 3. Clean inline comments — keep current invariants, remove history and divider rails.
> 4. Scaffold a new component — generate from the template.
> 5. Audit a directory — check all components, return a findings table.

## The 5 Core Practices

### Practice 1: Props Interface

- Use `export interface` (not `type`) — extends HTML attrs with `extends React.XHTMLAttributes<...>`
- Same file as the component, above it
- Every property gets a strict intent JSDoc comment; see Props Comment Standard
- `@defaultValue` on optional props with defaults
- `@see` for bidirectional cross-refs between related props (e.g. `sortable` ↔ `sortDirection`)
- `@deprecated` with migration path on sunset props
- `@internal` on exported-but-not-public-API symbols
- Never restate the TypeScript type — explain intent

### Practice 2: Component Definition

- `React.forwardRef` on every component — consumers need ref access
- **Skip forwardRef when:** the root element is a context provider (no DOM node), the component is generic (`<T>`), or the child component doesn't accept `ref` (check before wrapping)
- Named function inside `forwardRef` (not arrow) — shows in stack traces and DevTools
- `displayName` set immediately after definition
- Named export only (never default)
- Spread `...props` onto the root element — consumers can add `className`, `data-*`, `aria-*`
- **Skip `...props` spread when:** the root element is a context provider or compound wrapper with no single DOM root
- Destructure props in the function signature
- **Skip signature destructure when:** discriminated unions require runtime branching before destructure

### Practice 3: File Ordering

```
1. Imports (React, external deps, internal deps, utils)
2. Exported types (variant unions, prop interfaces)
3. Internal types (not exported)
4. Constants (variant maps, size maps — use `satisfies Record<>`)
5. Helper functions (internal, unexported)
6. Component definition (forwardRef + named function)
7. displayName
8. Compound sub-components (if any)
```

### Practice 4: JSDoc Coverage

| Export | Required JSDoc | Required Tags |
|--------|---------------|---------------|
| Component | `@summary` (one line) + optional `@example` (golden path usage) | `@summary` |
| Props interface | **Exactly** `/** Props for {@link ComponentName}. */` — nothing else | — |
| Every props property | One-line intent comment | `@defaultValue`, `@see`, `@deprecated` where applicable |
| Exported hook | Summary + `@example` | `@param`, `@returns` |
| Exported type/constant | Summary (one line) | — |
| Internal helper | None unless *why* is non-obvious | — |

**Props interface:** must be exactly this form — no other content.

```ts
/** Props for {@link ComponentName}. */
export interface ComponentNameProps {
```

**Component export:** must have `@summary`. Optional `@example`.

```ts
/**
 * @summary Renders the primary action users should take on a screen or form.
 *
 * @example
 * ```tsx
 * <Button variant="primary">Save</Button>
 * ```
 */
export const ComponentName = React.forwardRef<HTMLDivElement, ComponentNameProps>(
```

All metadata lives on the component. Props is only a link.

## Props Comment Standard

Prop comments are strict because they feed generated docs, registry context,
and agent understanding.

Use this shape:

- Start with what the prop does for the consumer.
- Keep the first sentence short and intent-focused.
- Put defaults in `@defaultValue`, not prose.
- Put linked-prop relationships in `@see`.
- Use `@deprecated` only with the migration path.
- Explain allowed values only when the names are not self-explanatory.
- For controlled props, name the ownership contract and link the change handler.
- For initial/default props, say they seed uncontrolled state and link the
  controlled prop that overrides them.
- For callback props, state the event or next value they emit and link the prop
  they round-trip.

Avoid:

- restating the TypeScript type;
- leading with "Optional" when the `?` already says that;
- implementation history, Figma node ids, ledger rows, or old deltas;
- internal class names, DOM mechanics, or layout archaeology;
- multi-line essays when one sentence plus a tag is enough.

Good:

```ts
/** Horizontal alignment of the header content. @defaultValue 'left' */
align?: 'left' | 'right' | 'center'

/** Padding owner for this content wrapper. @defaultValue 'cell' */
padding?: 'cell' | 'none'

/** Controlled selected row ids owned by the caller.
 * @see onSelectedRowIdsChange
 * @see initialSelectedRowIds */
selectedRowIds?: readonly string[]

/** Initial uncontrolled selected row ids.
 * @defaultValue []
 * @see selectedRowIds */
initialSelectedRowIds?: readonly string[]

/** Emits normalised selected row ids after a selection change.
 * @see selectedRowIds */
onSelectedRowIdsChange?: TableSelectionChangeHandler
```

Bad:

```ts
/** Optional padding policy. `cell` is correct for `<th>` layouts where each
 * cell owns its own padding. `none` is correct for list layouts where padding
 * lives on the row wrapper. @defaultValue 'cell' */
padding?: 'cell' | 'none'
```

## Inline Comment Standard

Inline comments are guidance, not the strict public-doc contract. Use them only
when the next maintainer or agent needs the reason behind a non-obvious
implementation choice. Comments should reduce future
inspection time, not narrate the code.

Keep comments that explain:

- current accessibility, focus, keyboard, layout, or state-machine invariants;
- why an otherwise surprising class, branch, effect, ref merge, or guard exists;
- a fragile integration contract with another local component, hook, test, or
  platform primitive;
- a fallback path that would be easy to simplify incorrectly.

Remove or compress comments that:

- restate the code, prop type, class name, or obvious JSX structure;
- preserve Figma node IDs, audit history, old deltas, ledger rows, or named
  reviewer notes without naming a current invariant;
- use decorative divider rails such as `// ----- Types -----`,
  `// ---------------------------------------------------------------------`,
  or boxed comment banners;
- duplicate the public JSDoc, Storybook description, or registry summary;
- explain a temporary migration after the migration is complete.

Preferred shape:

```ts
// Opaque fill masks scrolled rows beneath sticky cells.
```

Avoid:

```ts
// Figma node 1:61024 used #f8fafc; DELTA from old white header, ledger adv-003.
```

If evidence still matters, move it to the owning story, test, design audit, or
decision document and keep the source comment focused on the current contract.

### Practice 5: Barrel Export

```ts
// ComponentName/index.ts
export { ComponentName } from './ComponentName'
export type { ComponentNameProps } from './ComponentName'
```

- Explicit `export type` for interfaces — prevents accidental runtime imports
- Props types MUST be in the barrel — consumers need them for typed wrappers
- Internal helpers, constants, sub-components stay unexported unless documented
- Never re-export from sibling component directories

## JSDoc-Only Cleanup Mode

Use this mode for directory-wide or registry-facing summary cleanup. It narrows
the skill to comments and summary quality so broad loops do not accidentally
refactor component APIs.

Allowed edits:

- Move `@summary` from props/interface JSDoc to the public runtime component
  export.
- Rewrite component `@summary` text for clarity and registry discovery.
- Replace props/interface `@summary` with plain JSDoc such as
  `Props for {@link ComponentName}.`
- Preserve prop member intent comments and useful `@defaultValue`, `@see`,
  `@deprecated`, and `@internal` tags.
- Add or keep `@example` only when it helps a UI builder choose or compose the
  component.

Out of scope unless the user explicitly asks:

- `forwardRef` conversions.
- Props-interface reshaping.
- Barrel export changes.
- Story layout, Matrix, UxTips, or docs-card changes.
- Runtime behavior changes.

For directory-wide cleanup, stop before editing if the request is not explicitly
JSDoc-only or if owner-path verification fails.

## Inline-Comment Cleanup Mode

Use this mode for comment-only passes where the user asks to clean large inline
notes, old Figma/audit commentary, or decorative separators.

Allowed edits:

- Remove decorative divider rails.
- Compress multi-line history notes into one current invariant.
- Preserve comments that explain non-obvious accessibility, layout, focus,
  state, data, or integration contracts.
- Move no contracts between files unless the user explicitly asks for a docs or
  decision-record pass.

Out of scope unless the user explicitly asks:

- Runtime behavior changes.
- Public API changes.
- Story layout changes.
- New docs, ADRs, tests, or registry metadata.

Verification:

- Run focused lint on touched files.
- Run focused tests when comments sit beside brittle contracts or when nearby
  code was also changed.
- Search touched scope for decorative divider rails before finishing.

## Summary Audience And Research

Write summaries for UI builders and agent builders. The summary should help a
builder decide whether this component is the right Lego brick for a screen,
Figma design, screenshot, or product requirement.

Good summaries answer:

- What UI job does this component perform?
- When would a builder choose it?
- What screen pattern does it support?

Avoid:

- implementation details;
- prop lists;
- marketing copy;
- vague words such as "flexible", "powerful", or "simple";
- summaries that only restate the component name.

Research order:

1. Read local source, props, barrel exports, stories, tests, README/MDX, and
   nearby usage.
2. Use Storybook docs or matrix/UX stories as evidence for consumer-facing
   purpose.
3. Use external research only when local evidence does not make the component
   purpose clear.
4. Prefer official or authoritative sources: WAI-ARIA APG, WCAG, MDN, platform
   design docs, Radix, shadcn/ui, MUI, Carbon, GOV.UK, Apple HIG, or similar.
5. Extract principles; do not copy external wording.

Good summary examples:

- `@summary Renders the primary action users should take on a screen or form.`
- `@summary Displays a status message that confirms success, warns about risk, or explains an error.`
- `@summary Groups form fields into a single-page layout with section navigation.`
- `@summary Renders a horizontally scrollable data table with a custom visible scrollbar.`
- `@summary Lets users choose one option from a labelled set of radio choices.`

Bad summary examples:

- `@summary Button component.`
- `@summary A flexible and reusable button.`
- `@summary Uses class variance authority to render variants.`
- `@summary Props for Button.`
- `@summary Renders children with className support.`

## Storybook Registry Rules

Use these rules when the cleanup feeds Storybook MCP, AI manifests, or a
component registry.

- Public runtime component exports own exactly one `@summary`.
- Props interfaces never own `@summary` when paired with a component summary.
- Do not add fake summaries to stories, recipes, product examples, Matrix
  stories, UX guidance stories, or docs-only helpers.
- Allow multiple summaries in one file only when each belongs to a distinct
  public runtime export that should appear in registry documentation.
- Treat shadcn/Radix primitive files separately; multi-export primitive files
  can legitimately need multiple component summaries.
- If a docs-only entry must stay in the registry, use the package allowlist or
  registry checker owner instead of inventing a runtime component summary.

## Batch Loop Helper

For large portal-ui cleanup runs, generate a compact next-batch prompt instead
of reading the whole component library into context:

```bash
node /Users/nathanvale/code/claude-code-config/skills/component-library-standard/scripts/jsdoc-summary-loop.mjs \
  --repo /Users/nathanvale/code/experience-sdk \
  --pkg packages/portal-ui \
  --batch-size 8 \
  --reset
```

After a batch is edited and verified, advance the cursor:

```bash
node /Users/nathanvale/code/claude-code-config/skills/component-library-standard/scripts/jsdoc-summary-loop.mjs \
  --repo /Users/nathanvale/code/experience-sdk \
  --pkg packages/portal-ui \
  --batch-size 8 \
  --next
```

The helper writes loop state under `/tmp` and prints:

- current cursor;
- candidate component files;
- local evidence files to inspect;
- a copyable coordinator prompt for read-only explorer agents and one editor.

The helper is an inventory and prompt generator, not an edit engine. Agents must
still inspect files and apply this skill's JSDoc rules before changing code.

## Gotchas (builder safety rules)

- **Verify the child accepts `ref` before adding `forwardRef`.** Read the child component's type signature. If it's a plain function (no `forwardRef`), passing `ref` causes TS2322. Context providers (`<Select>`, `<RadioGroup>`) and Radix compound roots have no DOM node to forward to.
- **Verify imports after adding new API calls.** If you add `useId`, `useCallback`, `forwardRef`, etc., confirm they're in the import statement. Missing imports cause TS2304.
- **Extending with HTML attrs can create conflicts.** When the component has a custom `onChange`, `value`, or `children` prop, use `Omit<React.HTMLAttributes<...>, 'onChange' | 'value'>` to exclude conflicting attrs.
- **Don't spread `...props` onto context providers.** `<Select>`, `<RadioGroup>`, and similar wrappers are not DOM elements — spreading HTML attrs onto them causes type errors or silent prop drops.
- **Test after changes.** Run `tsc --noEmit` after applying fixes. A builder that breaks TypeScript has made things worse, not better.

## Component Template

```tsx
import { cn } from '@packages/utils'
import React from 'react'

/** Props for {@link ComponentName}. */
export interface ComponentNameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual treatment applied to the container. @defaultValue 'primary' */
  variant?: 'primary' | 'secondary'
  /** Controls the padding and font size. @defaultValue 'medium' */
  size?: 'medium' | 'small'
  /** Content rendered inside the component. */
  children?: React.ReactNode
}

const variantClass = {
  primary: 'bg-action-primary text-on-primary',
  secondary: 'border-2 border-action-primary bg-white text-action-primary',
} satisfies Record<NonNullable<ComponentNameProps['variant']>, string>

const sizeClass = {
  medium: 'min-h-10 px-5 py-2 text-base',
  small: 'min-h-9 px-4 py-1.5 text-sm',
} satisfies Record<NonNullable<ComponentNameProps['size']>, string>

/**
 * @summary Renders ... (one sentence explaining what and why — survives manifest truncation).
 *
 * @example
 * ```tsx
 * <ComponentName variant="primary" size="medium">
 *   Label text
 * </ComponentName>
 * ```
 */
export const ComponentName = React.forwardRef<HTMLDivElement, ComponentNameProps>(
  function ComponentName(
    { variant = 'primary', size = 'medium', className, children, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(variantClass[variant], sizeClass[size], className)}
        {...props}
      >
        {children}
      </div>
    )
  },
)

ComponentName.displayName = 'ComponentName'
```

## Barrel Template

```ts
// ComponentName/index.ts
export { ComponentName } from './ComponentName'
export type { ComponentNameProps } from './ComponentName'
```

## Audit Output Shape

When auditing, return a findings table:

```markdown
| Practice | Status | File:Line | Issue | Fix |
|----------|--------|-----------|-------|-----|
| 1. Props | FAIL | Button.tsx:6 | Props not exported | Add `export` keyword |
| 2. Component | FAIL | Button.tsx:30 | Missing forwardRef | Wrap in React.forwardRef |
| 3. Ordering | PASS | — | — | — |
| 4. JSDoc | FAIL | Button.tsx:8 | Missing `@summary` on component | Add `@summary` tag |
| 5. Barrel | FAIL | index.ts:1 | ButtonProps not exported | Add `export type { ButtonProps }` |
```

## Owner Paths

- JSDoc standard: `/Users/nathanvale/code/claude-code-config/context/code-style.md` §JSDoc
- Loop helper: `scripts/jsdoc-summary-loop.mjs`
- Pattern: `skills/create-skill/references/skill-design-decision-runbook.md#write-something-skill-io-example`

## Next Safe Action

- Audit a component? Name the file path.
- Scaffold a new component? Name the component and its HTML element base.
- Fix violations? Name the file — the skill reads it, applies fixes, reports what changed.
- Use in a workflow? Pass component file paths as args; the skill returns the findings table per component.
