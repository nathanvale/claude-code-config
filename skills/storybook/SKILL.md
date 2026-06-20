---
name: storybook
description: "Use Storybook MCP and local Storybook taxonomy for story discovery, previews, docs lookup, story test runs, or docs tree audits."
role: tool-workflow
---

# Storybook

Use when the user asks to set up, inspect, or call Storybook MCP, especially
through `mcporter`. Also use when the user asks for Storybook docs tree,
sidebar taxonomy, navigation, or story title audits.

Do not use for ordinary story authoring unless the task needs MCP access or
Storybook taxonomy/title organization.

## Owner Paths

- Readiness proof and diagnostics: `storybook-doctor` CLI (`src/`).
- Vocabulary: `CONTEXT.md`.
- Target repo Storybook config: nearest Storybook main config.
- Target repo package scripts and deps: nearest package manifest.
- Target repo Storybook test config: nearest Vitest, Playwright, or Storybook
  test config.
- Target repo taxonomy guide: nearest `STORYBOOK_TAXONOMY.md`.
- MCP discovery engine: `mcporter` CLI.
- Agent workflow guide: `references/mcp-agent-workflows.md`.
- Tips and troubleshooting: `references/tips-and-tricks.md`.
- Story authoring loop: `references/story-authoring-loop.md`.
- Docs pattern: `references/docs-pattern.md`.
- Component docs rollout: `references/component-docs-rollout.md`.
- Docs workflow completion checklist:
  `references/docs-workflow-checklist.md`.
- UX guidance pattern: `references/ux-guidance.md`.
- Matrix story pattern: `references/matrix-story-pattern.md`.
- Accessibility source route: `references/accessibility-source-route.md`.
- Provenance: `PROVENANCE.md`.

## Prerequisites

Before any Storybook MCP work, run `storybook-doctor check` against the target
project. It emits a readiness proof with `ready`, `degraded`, or `blocked`
status, structured findings, and a next safe action.

```bash
bun run --filter storybook-doctor-scripts storybook-doctor -- check --json --repo <path/to/project>
```

- `ready` → proceed to Quick Start.
- `degraded` → proceed; follow the `next_safe_action` for optional improvements.
- `blocked` → follow the `next_safe_action` to resolve; do not start MCP work.

For deeper diagnostics (local Storybook doctor evidence), run:

```bash
bun run --filter storybook-doctor-scripts storybook-doctor -- deep --json --repo <path/to/project>
```

## Quick Start

Default path: use the local ad-hoc endpoint. Do not persist MCP config.

1. Run `storybook-doctor check --json --repo <path/to/project>` to verify readiness.
2. Export `STORYBOOK_URL`, for example
   `export STORYBOOK_URL=http://localhost:6006`.
3. If Storybook is not running, start it using the target repo's dev script.
4. List tools with
   `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
5. Stop when the schema shows Storybook tools, then call only the tool needed.

## Pick One

- Need component props or examples: read `references/mcp-agent-workflows.md`,
  then call `list-all-documentation` and `get-documentation`.
- Need to edit or create stories: read `references/story-authoring-loop.md`,
  then call `get-storybook-story-instructions`.
- Need a complete top-to-bottom component Docs page pattern: read
  `references/docs-pattern.md` and
  `references/docs-workflow-checklist.md`, then use the Story Authoring Loop.
- Need to apply the hardened Autodocs pattern across one or more component
  stories: read `references/component-docs-rollout.md` and
  `references/docs-workflow-checklist.md`, then use the Story Authoring Loop.
- Need a polished docs page UX best-practice tips story, or guidance with matrix:
  read
  `references/ux-guidance.md` and
  `references/docs-workflow-checklist.md`, then use the Story Authoring Loop.
- Need a one-page visual review matrix: read
  `references/matrix-story-pattern.md`, then use the Story Authoring Loop.
- Need a review link: call `preview-stories` and return every preview URL.
- Need confidence after UI/story changes: call `run-story-tests` for affected
  stories with `a11y: true`.
- Need taxonomy cleanup: read the nearest `STORYBOOK_TAXONOMY.md`, audit titles,
  then run focused Storybook checks.
- Need to interpret or fix accessibility findings: read
  `references/accessibility-source-route.md`, then route claims to official
  sources before library docs or community examples.
- Need to repair a hung, stuck, or noisy Storybook process: run
  `storybook-doctor deep --json --repo <path/to/project>` first, then read
  `references/tips-and-tricks.md#hanging-or-stuck-process-triage` to classify
  server, builder, MCP, or test-runner failure before restarting.
- Need setup or repair: run `storybook-doctor check --json --repo <path/to/project>`, follow the
  `next_safe_action`, then read `references/tips-and-tricks.md` for common
  failures.

## Research Notes

- Storybook MCP is exposed by `@storybook/addon-mcp` at the running Storybook
  server's `/mcp` endpoint.
- Storybook MCP docs and package evidence show React support first while the
  feature is in preview.
- `@storybook/addon-vitest` exposes story-test tooling through MCP.
- `@storybook/addon-a11y` enables accessibility checks for story-test tooling.
- `mcporter call <server.tool | url>` supports configured servers and ad-hoc HTTP
  MCP endpoints.
- `preview-stories` returns user-openable preview URLs.
- `run-story-tests` can run interaction and accessibility checks for selected
  stories.
- Storybook docs recommend checking MCP docs before using design-system props.
- Community accessibility skills are research inputs, not authority. Use them
  to shape checklists; cite WCAG, WAI-ARIA APG, vendor, or library docs for
  factual accessibility claims.

## Workflow

Run commands from the target repo root.

1. Read the target repo's Storybook config and package scripts before changing
   setup.
2. For taxonomy, sidebar, docs tree, or story-title work, read the target repo
   taxonomy guide before proposing or editing titles.
3. Confirm Storybook MCP deps and config with `rg` against the target package
   manifest and Storybook config.
4. Confirm the local Storybook version with the target repo's package-manager
   command.
5. Check whether Storybook is already running at the expected local URL. If it
   responds, reuse it and verify `/mcp`. Start Storybook only when no healthy
   server is running.
6. If the default Storybook port is busy, use the next open port and carry that
   URL through every command.
7. When starting Storybook, use the target repo's Storybook dev script in a
   process that will stay alive for the browser session. Prefer the repo script.
   Use package-local scripts only when the root wrapper adds noise or fails. Use
   `tmux` only when available; it improves process reliability, not Storybook
   performance. If no detached process owner exists, keep the attached command
   running and tell the user that closing it will stop Storybook.
8. If Storybook appears hung, read
   `references/tips-and-tricks.md#hanging-or-stuck-process-triage` before
   starting another server.
9. Set `STORYBOOK_URL` to the running local Storybook origin, for example
   `export STORYBOOK_URL=http://localhost:6006`.
   Export it first, or replace `$STORYBOOK_URL` with the literal origin in each
   command.
10. Prove the raw MCP endpoint before debugging `mcporter`:
   `curl -sS -X POST "$STORYBOOK_URL/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`.
11. Inspect an ad-hoc local MCP endpoint with
   `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
12. Check configured MCP servers with `mcporter list`; treat that output as the
   discovery source of truth.
13. For ad-hoc local calls, prefer `mcporter call --http-url "$STORYBOOK_URL/mcp" --allow-http --tool <tool> --args '<json>'`.
14. For configured calls, run `mcporter list <server> --schema` before calling
    `<server>.<tool>`.
15. Before editing story files, call `get-storybook-story-instructions`.
16. Before using a design-system component prop, call `get-documentation` for
    that component.
17. Before structuring a complete component Docs page, read
    `references/docs-pattern.md`.
18. Before migrating the hardened Autodocs pattern across components, read
    `references/component-docs-rollout.md`.
19. Before adding a docs-page UX best-practice tips story, or guidance plus matrix, read
    `references/ux-guidance.md`.
20. Before adding a standalone matrix story, read `references/matrix-story-pattern.md`.
21. Before making non-obvious accessibility claims or trade-offs, read
    `references/accessibility-source-route.md`.
22. For component Docs workflows, read
    `references/docs-workflow-checklist.md` before final and return the completed
    checklist.
23. Use `preview-stories` for preview URLs, docs tools for documentation lookup,
    and `run-story-tests` for focused story checks.

## Taxonomy Workflow

- Treat the taxonomy guide as the owner of sidebar roots, folder meanings, and
  edge-case rules.
- If the taxonomy guide is missing, return degraded state and infer only from
  existing Storybook titles after naming the missing owner path.
- Prefer moving story `title` values over moving component files when the
  request is about docs tree cognition.
- After taxonomy edits, check for stale namespaces with `rg` before running
  Storybook build or story tests.
- If a component fits two folders, use the guide's consumer-task rule instead
  of inventing a new category.

## Tool Recipes

Use literal URLs when the shell has not exported `STORYBOOK_URL`; inline env
assignment does not expand later words in the same command.

```bash
export STORYBOOK_URL=http://localhost:6006
mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema
mcporter call --http-url "$STORYBOOK_URL/mcp" --allow-http \
  --tool preview-stories \
  --args '{"stories":[{"storyId":"ui-forms-select--matrix"}]}'
mcporter call --http-url "$STORYBOOK_URL/mcp" --allow-http \
  --tool run-story-tests \
  --args '{"stories":[{"storyId":"ui-forms-select--matrix"}],"a11y":true}'
```

## Output Shape

- Start with one status line: connected, blocked, or degraded.
- Name the tool used and the story target.
- Include preview URLs when `preview-stories` returns them.
- Summarize tool schemas; do not paste the full schema unless the user asks.
- End with one next action.

## Rules

- Do not mutate persistent MCP config without explicit user approval.
- Do not expose Storybook beyond loopback unless the user asks.
- Do not print secrets, headers, or token-bearing config.
- Do not guess component props. Inspect Storybook MCP documentation first.
- Do not invent tool schemas; inspect `tools/list`, `mcporter list --schema`, or
  official docs first.
- Do not copy taxonomy category contracts into the skill; link the target repo
  taxonomy guide and update that owner when categories change.
- Do not skip focused `run-story-tests` after story/component changes when MCP
  is available.
- Do not treat marketplace, awesome-list, or community skill guidance as
  authority. Use it as checklist input, then route factual accessibility claims
  through `references/accessibility-source-route.md`.
- Fix semantic accessibility violations directly. Ask before visual/design
  changes such as color contrast, spacing, or focus-ring styling.
- If `mcporter` is broken, use the `mcp-doctor` skill when available; otherwise
  run `mcporter list --status --json`.
- If the project is not React, report the preview-support gap before proceeding.
- Do not kill Storybook, Vite, Webpack, Playwright, or browser processes unless
  the process was started for this task or the user approves the named PID and
  command.

## Verification

- Raw endpoint lists tools from `$STORYBOOK_URL/mcp`.
- `mcporter list` shows the expected configured server, or ad-hoc call succeeds.
- `mcporter call ... preview-stories` returns a preview URL when story input is
  valid.
- `mcporter call ... run-story-tests` returns pass/fail story test output.
- Taxonomy edits leave no stale legacy title namespace for the changed tree.
- Target repo Storybook build passes after setup changes.
- Changed skill docs pass YAML parse and owner-path checks.
- Component Docs work includes a completed
  `references/docs-workflow-checklist.md` checklist in the final handoff.

## Next Safe Actions

DX lens: present choices as a short numbered list only when user choice changes
target, risk, or next action. Bold the recommended default.

1. Unknown readiness -> **run `storybook-doctor check --json --repo <path/to/project>`**; follow the
   `next_safe_action`.
2. Deeper diagnosis needed -> run `storybook-doctor deep --json --repo <path/to/project>`.
3. Need a Storybook URL -> call `preview-stories`, then return the preview URL.
4. Need confidence -> call `run-story-tests` for focused stories first.
5. Need taxonomy cleanup -> read `STORYBOOK_TAXONOMY.md`, audit titles, then
   run focused Storybook checks.
6. Storybook appears hung -> **run `storybook-doctor deep --json --repo <path/to/project>`**, then read
   `references/tips-and-tricks.md#hanging-or-stuck-process-triage`; classify
   before restart.
7. Want persistent setup -> ask before adding or changing `mcporter` config.
