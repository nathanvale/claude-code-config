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

- Target repo Storybook config: nearest Storybook main config.
- Target repo package scripts and deps: nearest package manifest.
- Target repo Storybook test config: nearest Vitest, Playwright, or Storybook
  test config.
- Target repo taxonomy guide: nearest `STORYBOOK_TAXONOMY.md`.
- MCP discovery engine: `mcporter` CLI.
- Agent workflow guide: `references/mcp-agent-workflows.md`.
- Tips and troubleshooting: `references/tips-and-tricks.md`.
- Story authoring loop: `references/story-authoring-loop.md`.
- Matrix story pattern: `references/matrix-story-pattern.md`.
- Accessibility source route: `references/accessibility-source-route.md`.
- Provenance: `PROVENANCE.md`.

## Quick Start

Default path: use the local ad-hoc endpoint. Do not persist MCP config.

1. Export `STORYBOOK_URL`, for example
   `export STORYBOOK_URL=http://localhost:6006`.
2. Check whether Storybook is already running at that URL. If it responds,
   reuse it and verify `/mcp`. Start Storybook only when no healthy server is
   running.
3. List tools with
   `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
4. Stop when the schema shows Storybook tools, then call only the tool needed.

## Pick One

- Need component props or examples: read `references/mcp-agent-workflows.md`,
  then call `list-all-documentation` and `get-documentation`.
- Need to edit or create stories: read `references/story-authoring-loop.md`,
  then call `get-storybook-story-instructions`.
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
- Need setup or repair: use the Workflow below, then read
  `references/tips-and-tricks.md` for common failures.

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
8. Set `STORYBOOK_URL` to the running local Storybook origin, for example
   `export STORYBOOK_URL=http://localhost:6006`.
   Export it first, or replace `$STORYBOOK_URL` with the literal origin in each
   command.
9. Prove the raw MCP endpoint before debugging `mcporter`:
   `curl -sS -X POST "$STORYBOOK_URL/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`.
10. Inspect an ad-hoc local MCP endpoint with
   `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
11. Check configured MCP servers with `mcporter list`; treat that output as the
   discovery source of truth.
12. For ad-hoc local calls, prefer `mcporter call --http-url "$STORYBOOK_URL/mcp" --allow-http --tool <tool> --args '<json>'`.
13. For configured calls, run `mcporter list <server> --schema` before calling
    `<server>.<tool>`.
14. Before editing story files, call `get-storybook-story-instructions`.
15. Before using a design-system component prop, call `get-documentation` for
    that component.
16. Before adding a matrix story, read `references/matrix-story-pattern.md`.
17. Before making non-obvious accessibility claims or trade-offs, read
    `references/accessibility-source-route.md`.
18. Use `preview-stories` for preview URLs, docs tools for documentation lookup,
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

## Verification

- Raw endpoint lists tools from `$STORYBOOK_URL/mcp`.
- `mcporter list` shows the expected configured server, or ad-hoc call succeeds.
- `mcporter call ... preview-stories` returns a preview URL when story input is
  valid.
- `mcporter call ... run-story-tests` returns pass/fail story test output.
- Taxonomy edits leave no stale legacy title namespace for the changed tree.
- Target repo Storybook build passes after setup changes.
- Changed skill docs pass YAML parse and owner-path checks.

## Next Safe Actions

DX lens: present choices as a short numbered list only when user choice changes
target, risk, or next action. Bold the recommended default.

1. No MCP config or unclear state -> **prove local endpoint** with ad-hoc
   `mcporter`; no config writes.
2. Need a Storybook URL -> call `preview-stories`, then return the preview URL.
3. Need confidence -> call `run-story-tests` for focused stories first.
4. Need taxonomy cleanup -> read `STORYBOOK_TAXONOMY.md`, audit titles, then
   run focused Storybook checks.
5. Want persistent setup -> ask before adding or changing `mcporter` config.
