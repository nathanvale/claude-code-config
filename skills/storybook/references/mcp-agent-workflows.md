# MCP Agent Workflows

Use this when Storybook MCP should guide UI work, not just return a link.

## Default Loop

1. Discover component or docs IDs.
2. Read component docs before using props.
3. Call story instructions before changing stories.
4. Edit component or story.
5. Preview affected stories.
6. Run focused story tests with accessibility on.
7. Fix semantic failures and rerun.
8. Return preview URLs and test summary.

## Discovery

For portal-ui or any Storybook with AI manifests enabled, start with the registry shape:

1. Use `list-all-documentation` to find candidate components by purpose.
2. Use `get-documentation` before using props, variants, or examples.
3. Prefer components whose manifest entry has a clear purpose sentence and realistic
   examples.
4. Treat visual audit Matrix stories as human review aids, not usage examples.
5. If a component lacks a useful purpose sentence, inspect source or ask for the registry
   to be repaired before broad rollout work.

Use `list-all-documentation` when the component ID is unknown.

Use `withStoryIds: true` when the next call needs story IDs for preview or
focused tests.

Use `get-documentation` before using design-system component props. Treat props
as valid only when the docs or story examples show them.

Use `get-documentation-for-story` when the first three examples do not cover the
variant or state being changed.

## Story Preview

Prefer `{ "storyId": "..." }` when the ID is known.

Use `{ "absoluteStoryPath": "...", "exportName": "..." }` only when already
working inside that story file.

Pass `props` only for temporary preview variants. Persist real review states in
the story file when they matter for regressions.

Return every `previewUrl` from `preview-stories` in the user-facing response.

## Story Tests

Use `run-story-tests` with focused `stories` while iterating.

Set `a11y: true` by default.

Run all stories only when impact is broad, the user asks, or focused impact is
unclear.

Interpret output this way:

- Passing stories: mention compactly.
- Failing stories: inspect failure details, fix, rerun.
- Accessibility violations: fix semantic issues directly; ask before visual
  changes.

## Component Prop Safety

Do not infer props from naming conventions, other design systems, or memory.

If a prop is absent from Storybook docs and examples, do not use it without a
local source read or user confirmation.

When a component has no docs entry, fall back to source inspection and say MCP
docs were unavailable for that component.

## Registry Health

For portal-ui, run this before relying on Storybook as an agent component registry:

```bash
pnpm --filter @packages/portal-ui check:agent-registry
```

The gate expects:

- exported runtime components have component-level `@summary` metadata.
- manifest stories exist for each component.
- public import snippets contain runtime components only.
- Matrix/story-helper imports do not leak into agent-facing snippets.
- intentional non-component docs entries live in the package allowlist.

## Remote And Composed Storybooks

When multiple Storybooks are composed, prefer docs tools that expose
`storybookId`.

For team-wide agent context, prefer a Chromatic-published MCP URL over exposing a
local Storybook server.

Do not persist remote MCP config without user approval.
