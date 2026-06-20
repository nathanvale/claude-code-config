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
| File path or component name | Audit that component against the 5 practices |
| "scaffold" / "new component" / "template" | Generate a new component from the template |
| "fix" / "heal" + file path | Fix violations in-place |
| "audit" / "check" + directory | Audit all components in directory, return findings |

### No-args menu

> **Component Library Standard — pick an action:**
>
> 1. **Audit a component** — name a file or component to check against the 5 practices.
> 2. Scaffold a new component — generate from the template.
> 3. Audit a directory — check all components, return a findings table.
> 4. Show the 5 practices — print the rules for reference.

## The 5 Core Practices

### Practice 1: Props Interface

- Use `export interface` (not `type`) — extends HTML attrs with `extends React.XHTMLAttributes<...>`
- Same file as the component, above it
- Every property gets a one-line JSDoc comment explaining *intent*, not restating the type
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
| Props interface | Plain one-line summary, usually `Props for {@link ComponentName}.` | — |
| Every props property | One-line intent comment | `@defaultValue`, `@see`, `@deprecated` where applicable |
| Exported hook | Summary + `@example` | `@param`, `@returns` |
| Exported type/constant | Summary (one line) | — |
| Internal helper | None unless *why* is non-obvious | — |

`@summary` is required on every exported component — it survives Storybook manifest truncation and powers MCP/agent queries via `experimentalComponentsManifest`. Without it, the component is invisible to agent tooling even when stories exist.

Keep the manifest-facing `@summary` on the public runtime component export. Do not duplicate it on the matching props interface; props interfaces get plain JSDoc plus property intent comments.

Anti-patterns:
- `/** The label string */` on `label: string` — restates the type
- `{@type}` annotations — TypeScript handles types
- Missing useful `@example` on stable public components — highest-value tag when it shows real usage
- Missing `@summary` on component — invisible to Storybook manifest and MCP
- Duplicate `@summary` on both `ComponentNameProps` and `ComponentName` — unclear owner, noisy docs

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

// ── Types ────────────────────────────────────────────────────────────────────

/** Props for {@link ComponentName}. */
export interface ComponentNameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual treatment applied to the container. @defaultValue 'primary' */
  variant?: 'primary' | 'secondary'
  /** Controls the padding and font size. @defaultValue 'medium' */
  size?: 'medium' | 'small'
  /** Content rendered inside the component. */
  children?: React.ReactNode
}

// ── Constants ────────────────────────────────────────────────────────────────

const variantClass = {
  primary: 'bg-action-primary text-on-primary',
  secondary: 'border-2 border-action-primary bg-white text-action-primary',
} satisfies Record<NonNullable<ComponentNameProps['variant']>, string>

const sizeClass = {
  medium: 'min-h-10 px-5 py-2 text-base',
  small: 'min-h-9 px-4 py-1.5 text-sm',
} satisfies Record<NonNullable<ComponentNameProps['size']>, string>

// ── Component ────────────────────────────────────────────────────────────────

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
- Pattern: `references/skill-design-decision-runbook.md#write-something-skill-io-example`

## Next Safe Action

- Audit a component? Name the file path.
- Scaffold a new component? Name the component and its HTML element base.
- Fix violations? Name the file — the skill reads it, applies fixes, reports what changed.
- Use in a workflow? Pass component file paths as args; the skill returns the findings table per component.
