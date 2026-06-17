# Tips And Troubleshooting

Use this when Storybook MCP setup, calls, or output are confusing.

## High-Leverage Tips

- Use docs tools before code changes.
- Use `preview-stories` after every UI or story change.
- Use focused `run-story-tests` as the UI handoff gate.
- Keep `a11y` enabled unless debugging non-a11y behavior only.
- Return story links even when tests pass.
- Prefer Storybook MCP over manual URL guessing when the tool is available.
- Use matrices for design review and individual stories for stable permalinks.

## Shell Gotchas

Inline env assignment does not expand later words in the same command:

```bash
STORYBOOK_URL=http://localhost:6006 mcporter list --http-url "$STORYBOOK_URL/mcp"
```

That can become `/mcp`. Export first or use a literal URL:

```bash
export STORYBOOK_URL=http://localhost:6006
mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema
```

## Local Server Lifetime

Storybook MCP depends on the running Storybook dev server. If the process exits,
Chrome can still show an old tab, but `/mcp` and previews will fail.

Prefer this order:

1. Use the repo's documented Storybook dev script.
2. Use a repo-owned daemon or QA helper when one exists.
3. Use `tmux` or another local process supervisor only when installed.
4. Keep the attached terminal running and report that closing it stops Storybook.

Do not make `tmux` a requirement. It is a convenience for local persistence, not
a Storybook performance optimization.

## Endpoint Checks

Raw MCP check:

```bash
curl -sS -X POST "$STORYBOOK_URL/mcp" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Schema check:

```bash
mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema
```

## Common Failures

`Invalid URL`:

- Check whether `STORYBOOK_URL` is exported.
- Retry with a literal `http://localhost:<port>/mcp`.

No MCP tools:

- Confirm `@storybook/addon-mcp` is installed.
- Confirm the addon is listed in nearest Storybook main config.
- Restart Storybook after config changes.

Connection drops after opening Storybook:

- Check that the Storybook server process is still running.
- Check `curl -fsS "$STORYBOOK_URL/"` before debugging MCP.
- Check that the port did not change after restart.
- Restart with a stable process owner, then refresh Chrome.

`run-story-tests` missing or degraded:

- Confirm `@storybook/addon-vitest` is installed and configured.
- Check the nearest Vitest config for a Storybook project.

Accessibility checks missing:

- Confirm `@storybook/addon-a11y` is installed and configured.
- Run `run-story-tests` with `a11y: true`.

Preview URL returns the manager instead of iframe:

- That is acceptable for user review links.
- Use browser/devtools iframe URLs only for pixel or accessibility snapshots.

## A11y Response Policy

Fix directly:

- Missing labels.
- Decorative SVGs exposed as images.
- Wrong ARIA roles or state.
- Duplicate IDs.
- Broken keyboard paths.

Ask first:

- Color contrast changes.
- Spacing or layout changes.
- Focus-ring visual design changes.
- Typography size changes.

## References

- Storybook MCP overview: `https://storybook.js.org/docs/ai/mcp/overview`.
- Storybook MCP API: `https://storybook.js.org/docs/ai/mcp/api`.
- Storybook AI docs: `https://storybook.js.org/docs/ai`.
