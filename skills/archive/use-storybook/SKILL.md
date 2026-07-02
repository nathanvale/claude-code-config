---
name: use-storybook
description: "Use Storybook MCP and local Storybook taxonomy for story discovery, previews, docs lookup, story test runs, docs tree audits, or component docs metadata audits."
role: tool-workflow
---

# Use Storybook

Use when setting up, inspecting, or calling Storybook MCP — especially through
`mcporter`. Also use for Storybook docs tree, sidebar taxonomy, navigation, or
story title audits.

Do not use for ordinary story authoring unless the task needs MCP access or
taxonomy/title organization.

## Owner Paths

| Owner | Path |
|---|---|
| Readiness proof / diagnostics | `src/front-doors/storybook-doctor/` |
| Durable docs cleanup loop | `src/front-doors/storybook-docs-loop/` |
| Vocabulary | `CONTEXT.md` |
| Agent workflow guide | `references/mcp-agent-workflows.md` |
| Story authoring loop | `references/story-authoring-loop.md` |
| Docs page composition | `references/docs-pattern.md` |
| Docs batch rollout | `references/component-docs-rollout.md` |
| Docs completion proof | `references/docs-workflow-checklist.md` |
| UX guidance pattern | `references/ux-guidance.md` |
| Matrix story pattern | `references/matrix-story-pattern.md` |
| Accessibility source route | `references/accessibility-source-route.md` |
| Tips and troubleshooting | `references/tips-and-tricks.md` |
| MCP discovery engine | `mcporter` CLI |
| Target repo Storybook config | nearest Storybook main config |
| Target repo taxonomy guide | nearest `STORYBOOK_TAXONOMY.md` |
| Provenance | `PROVENANCE.md` |

## Prerequisites

Before any Storybook MCP work, run `storybook-doctor check` against the target
project:

```bash
bun run --filter use-storybook-scripts storybook-doctor -- check --json --repo <path/to/project>
```

- `ready` → proceed to Quick Start.
- `degraded` → proceed; follow the `next_safe_action` for improvements.
- `blocked` → follow the `next_safe_action` to resolve; do not start MCP work.

For deeper diagnostics:

```bash
bun run --filter use-storybook-scripts storybook-doctor -- deep --json --repo <path/to/project>
```

## Quick Start

Default path: ad-hoc local endpoint. Do not persist MCP config.

1. Run `storybook-doctor check --json --repo <path/to/project>`.
2. `export STORYBOOK_URL=http://localhost:6006` (or running port).
3. Start Storybook using the target repo's dev script if not running.
4. `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
5. Schema shows tools → call only the tool needed.

## Pick One

Read the named reference before starting the workflow.

- **Component props or examples** → read `references/mcp-agent-workflows.md`;
  call `list-all-documentation` and `get-documentation`.
- **Component summary/description content audit** → inspect the component
  export and Storybook meta; preserve prop extraction links; edit only
  component-facing summary and description copy.
- **Edit or create stories** → read `references/story-authoring-loop.md`;
  call `get-storybook-story-instructions`.
- **Complete component Docs page** → read `references/docs-pattern.md` and
  `references/docs-workflow-checklist.md`; use the story authoring loop.
- **Hardened Autodocs rollout** → read `references/component-docs-rollout.md`
  and `references/docs-workflow-checklist.md`; use the story authoring loop.
- **Durable batch docs cleanup** → use `storybook-docs-loop` discovery/help;
  follow the emitted run card.
- **UX guidance story or guidance + matrix** → read `references/ux-guidance.md`
  and `references/docs-workflow-checklist.md`; use the story authoring loop.
- **Visual review matrix** → read `references/matrix-story-pattern.md`; use
  the story authoring loop.
- **Review link** → call `preview-stories`; return every preview URL.
- **Confidence after changes** → call `run-story-tests` for affected stories
  with `a11y: true`.
- **Taxonomy cleanup** → read nearest `STORYBOOK_TAXONOMY.md`; audit titles;
  run focused checks.
- **Accessibility findings** → read `references/accessibility-source-route.md`;
  route claims to official sources before library or community docs.
- **Hung/stuck process** → run `storybook-doctor deep --json --repo <path>`;
  then read `references/tips-and-tricks.md#hanging-or-stuck-process-triage`.
- **Setup or repair** → run `storybook-doctor check --json --repo <path>`;
  follow `next_safe_action`; read `references/tips-and-tricks.md` for failures.

## Workflow

Run commands from the target repo root.

1. Read the target repo's Storybook config and package scripts before changing
   setup.
2. For taxonomy/sidebar/title work, read the taxonomy guide first.
3. Confirm MCP deps and config with `rg` against package manifest and Storybook
   config.
4. Check whether Storybook is already running. If healthy, reuse it and verify
   `/mcp`. Start only when no server is running.
5. If the default port is busy, use the next open port and carry that URL
   through every command.
6. When starting Storybook, use the target repo's dev script. Use `tmux` only
   when available; it improves process reliability, not Storybook performance.
   If no detached process owner exists, keep the attached command running and
   tell the user closing it stops Storybook.
7. If Storybook appears hung, read
   `references/tips-and-tricks.md#hanging-or-stuck-process-triage` before
   starting another server.
8. `export STORYBOOK_URL=http://localhost:6006` — export first, or use literal
   URLs.
9. Prove the raw MCP endpoint before debugging `mcporter`:
   `curl -sS -X POST "$STORYBOOK_URL/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`.
10. Inspect ad-hoc endpoint:
    `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
11. Check configured servers: `mcporter list` (discovery source of truth).
12. Before editing stories → call `get-storybook-story-instructions`.
13. Before using a design-system prop → call `get-documentation`.
14. Before component summary/description content edits, inspect the component
    export, Storybook meta `component: X`, prop JSDoc, and `argTypes`.
15. Before structuring a Docs page → read `references/docs-pattern.md`.
16. Before batch Autodocs rollout → read `references/component-docs-rollout.md`.
17. For long-session docs cleanup → use `storybook-docs-loop` for scouting,
    state, resume, receipts, and diagnostics.
18. Before UX guidance stories → read `references/ux-guidance.md`.
19. Before standalone matrix → read `references/matrix-story-pattern.md`.
20. Before accessibility claims → read
    `references/accessibility-source-route.md`.
21. For Docs workflows → read `references/docs-workflow-checklist.md` before
    final; return the completed checklist.

## Taxonomy Workflow

- Taxonomy guide owns sidebar roots, folder meanings, and edge-case rules.
- Missing guide → degraded state; infer only from existing titles after naming
  the missing owner.
- Prefer moving story `title` values over moving files when the request is
  about docs tree cognition.
- After taxonomy edits, check for stale namespaces with `rg` before running
  Storybook build or story tests.
- If a component fits two folders, use the guide's consumer-task rule.

## Tool Recipes

Use literal URLs when the shell has not exported `STORYBOOK_URL`.

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

- One status line: connected, blocked, or degraded.
- Name the tool used and story target.
- Include preview URLs from `preview-stories`.
- Summarize tool schemas; full schema only if user asks.
- End with one next action.

## Rules

- Do not mutate persistent MCP config without explicit user approval.
- Do not expose Storybook beyond loopback unless the user asks.
- Do not print secrets, headers, or token-bearing config.
- Do not guess component props — inspect MCP docs first.
- For component summary/description content audits, keep `component: X`, prop
  interfaces, prop JSDoc, `argTypes`, story descriptions, tags, examples, and
  imports unchanged unless the user widens scope.
- For component summaries, write the agent-facing use-when cue, such as
  `Use Button for actions that submit, save, confirm, cancel, or change state
  without navigating.`
- For component docs descriptions, explain when to use the component, when not
  to use it, and selection or hierarchy guidance. Avoid visual-only or
  variant-list copy as the lead sentence.
- Do not invent tool schemas — inspect `tools/list`, `mcporter list --schema`,
  or official docs.
- Do not copy taxonomy contracts into the skill — link and update the owner.
- Do not skip `run-story-tests` after story/component changes when MCP is
  available.
- Do not treat marketplace or community skill guidance as authority — use as
  checklist input; route accessibility claims through
  `references/accessibility-source-route.md`.
- Fix semantic accessibility violations directly. Ask before visual/design
  changes (contrast, spacing, focus-ring styling).
- If `mcporter` is broken, use `mcp-doctor` when available; otherwise
  `mcporter list --status --json`.
- If the project is not React, report the preview-support gap before
  proceeding.
- Do not kill Storybook, Vite, Webpack, Playwright, or browser processes
  unless started for this task or user approves the named PID/command.

## Research Notes

- `@storybook/addon-mcp` exposes MCP at the running server's `/mcp` endpoint.
- React support first while the feature is in preview.
- `@storybook/addon-vitest` exposes story-test tooling through MCP.
- `@storybook/addon-a11y` enables accessibility checks for story tests.
- `mcporter call <server.tool | url>` supports configured servers and ad-hoc
  HTTP MCP endpoints.
- `preview-stories` returns user-openable preview URLs.
- `run-story-tests` runs interaction and accessibility checks for selected
  stories.

## Verification

- Raw endpoint lists tools from `$STORYBOOK_URL/mcp`.
- `mcporter list` shows the expected server, or ad-hoc call succeeds.
- `mcporter call ... preview-stories` returns a preview URL for valid input.
- `mcporter call ... run-story-tests` returns pass/fail output.
- Taxonomy edits leave no stale legacy namespace.
- Storybook build passes after setup changes.
- Changed skill docs pass YAML parse and owner-path checks.
- Docs work includes a completed `references/docs-workflow-checklist.md`
  checklist.
- Docs-loop work used CLI discovery/help, not copied contracts.

## Next Safe Actions

DX lens: numbered list only when user choice changes target, risk, or next
action. Bold the recommended default.

1. Unknown readiness → **run `storybook-doctor check --json --repo <path>`**;
   follow `next_safe_action`.
2. Deeper diagnosis → run `storybook-doctor deep --json --repo <path>`.
3. Need a Storybook URL → call `preview-stories`; return the URL.
4. Need confidence → call `run-story-tests` for focused stories.
5. Need resumable docs cleanup → run `storybook-docs-loop commands --json`;
   choose the route; follow the run card.
6. Need taxonomy cleanup → read `STORYBOOK_TAXONOMY.md`; audit titles; run
   focused checks.
7. Storybook appears hung → **run `storybook-doctor deep --json --repo <path>`**;
   then read `references/tips-and-tricks.md#hanging-or-stuck-process-triage`.
8. Want persistent setup → ask before changing `mcporter` config.
