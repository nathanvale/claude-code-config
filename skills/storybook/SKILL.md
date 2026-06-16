---
name: storybook
description: "Use Storybook MCP through mcporter for story discovery, previews, docs lookup, or story test runs."
role: tool-workflow
---

# Storybook

Use when the user asks to set up, inspect, or call Storybook MCP, especially
through `mcporter`.

Do not use for ordinary story authoring unless the task needs MCP access.

## Owner Paths

- Target repo Storybook config: nearest Storybook main config.
- Target repo package scripts and deps: nearest package manifest.
- Target repo Storybook test config: nearest Vitest, Playwright, or Storybook
  test config.
- MCP discovery engine: `mcporter` CLI.

## Quick Start

Default path: use the local ad-hoc endpoint. Do not persist MCP config.

1. Start or find Storybook.
2. Export `STORYBOOK_URL`.
3. List tools with `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
4. Stop when the schema shows Storybook tools, then call only the tool needed.

## Research Notes

- Storybook MCP is exposed by `@storybook/addon-mcp` at the running Storybook
  server's `/mcp` endpoint.
- Storybook MCP docs and package evidence show React support first while the
  feature is in preview.
- `@storybook/addon-vitest` exposes story-test tooling through MCP.
- `@storybook/addon-a11y` enables accessibility checks for story-test tooling.
- `mcporter call <server.tool | url>` supports configured servers and ad-hoc HTTP
  MCP endpoints.

## Workflow

Run commands from the target repo root.

1. Read the target repo's Storybook config and package scripts before changing
   setup.
2. Confirm Storybook MCP deps and config with `rg` against the target package
   manifest and Storybook config.
3. Confirm the local Storybook version with the target repo's package-manager
   command.
4. Start Storybook with the target repo's Storybook dev script.
5. If the default Storybook port is busy, use the next open port and carry that
   URL through every command.
6. Set `STORYBOOK_URL` to the running local Storybook origin, for example
   `export STORYBOOK_URL=http://localhost:6006`.
   Export it first, or replace `$STORYBOOK_URL` with the literal origin in each
   command.
7. Prove the raw MCP endpoint before debugging `mcporter`:
   `curl -sS -X POST "$STORYBOOK_URL/mcp" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`.
8. Inspect an ad-hoc local MCP endpoint with
   `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.
9. Check configured MCP servers with `mcporter list`; treat that output as the
   discovery source of truth.
10. For ad-hoc local calls, prefer `mcporter call --http-url "$STORYBOOK_URL/mcp" --allow-http --tool <tool> --args '<json>'`.
11. For configured calls, run `mcporter list <server> --schema` before calling
    `<server>.<tool>`.
12. Use `preview-stories` for preview URLs, docs tools for documentation lookup,
    and `run-story-tests` for focused story checks.

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
- Do not invent tool schemas; inspect `tools/list`, `mcporter list --schema`, or
  official docs first.
- If `mcporter` is broken, use the `mcp-doctor` skill when available; otherwise
  run `mcporter list --status --json`.
- If the project is not React, report the preview-support gap before proceeding.

## Verification

- Raw endpoint lists tools from `$STORYBOOK_URL/mcp`.
- `mcporter list` shows the expected configured server, or ad-hoc call succeeds.
- `mcporter call ... preview-stories` returns a preview URL when story input is
  valid.
- `mcporter call ... run-story-tests` returns pass/fail story test output.
- Target repo Storybook build passes after setup changes.

## Next Safe Actions

DX lens: present choices as a short numbered list only when user choice changes
target, risk, or next action. Bold the recommended default.

1. No MCP config or unclear state -> **prove local endpoint** with ad-hoc
   `mcporter`; no config writes.
2. Need a Storybook URL -> call `preview-stories`, then return the preview URL.
3. Need confidence -> call `run-story-tests` for focused stories first.
4. Want persistent setup -> ask before adding or changing `mcporter` config.
