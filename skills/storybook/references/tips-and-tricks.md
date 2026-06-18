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

## Hanging Or Stuck Process Triage

Use this when Storybook starts but appears to hang, leaves processors running,
never reaches MCP, or tests wait without clear output.

First classify the failure:

1. Server not listening.
2. Server listening, but manager or preview returns errors.
3. Manager works, but `/mcp` or `mcporter` fails.
4. Builder stuck on transforms, dependency prebundle, or Webpack compile.
5. Test runner or browser workers hang after Storybook is healthy.

Collect local evidence before restart:

```bash
export STORYBOOK_URL=http://localhost:6006
curl -fsS "$STORYBOOK_URL/" >/dev/null
curl -fsS "$STORYBOOK_URL/index.json" >/dev/null
curl -sS -X POST "$STORYBOOK_URL/mcp" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
lsof -nP -iTCP:6006 -sTCP:LISTEN
```

If the port is wrong, replace `6006` and `STORYBOOK_URL` everywhere. Do not
start a second server until the port owner is known.

### Self-Repair Ladder

1. Prove startup with an exact port and no browser auto-open:

   ```bash
   npm run storybook -- -p 6006 --exact-port --ci --no-open --smoke-test --debug
   ```

   Use the repo package manager and script name. With npm, pass Storybook flags
   after `--`.

2. If `dev` output is vague, run a build for clearer errors:

   ```bash
   npm run build-storybook -- --debug
   ```

3. Check dependency and addon drift:

   ```bash
   npx storybook doctor --debug
   npx storybook info
   ```

   Look for duplicate Storybook packages, mismatched versions, incompatible
   addons, unsupported Node versions, and non-Storybook community addons.

4. If Vite or Webpack appears stuck, inspect inherited builder config before
   changing Storybook config:

   - Temporarily disable project-only Vite plugins that are not needed in
     Storybook, especially module federation, dev-server proxies, coverage
     instrumentation, and app-only transforms.
   - Narrow stories globs to one known story and retry.
   - For Webpack, retry with `--debug-webpack` or `--stats-json /tmp/sb-stats`.
   - For Vite, inspect `viteFinal`, aliases, optimize deps, and plugin hooks.

5. If memory climbs or the process exits late, reduce work before increasing
   resources:

   - Disable coverage and visual snapshot hooks.
   - Narrow story globs or tags.
   - Run build with `NODE_OPTIONS=--max-old-space-size=4096` only after the
     smaller repro still fails.

6. If test execution hangs, prove Storybook readiness first, then reduce browser
   concurrency:

   ```bash
   npm run test-storybook -- --url "$STORYBOOK_URL" --maxWorkers=2 \
     --testTimeout=60000 --verbose
   npm run test-storybook -- --clearCache
   ```

   Check whether a `play` function, `postVisit`, asset wait, snapshot, or a11y
   hook is waiting forever. Prefer one story or one tag before all stories.

7. If MCP hangs but Storybook is healthy, debug MCP separately:

   - Check raw `/mcp` before `mcporter`.
   - Confirm `@storybook/addon-mcp` is installed and listed in Storybook config.
   - Restart Storybook after addon/config changes.
   - Run `mcporter list --http-url "$STORYBOOK_URL/mcp" --allow-http --schema`.

8. If a stale process owns the port, stop only a process started for this task.
   Otherwise report the PID, command, and port, then ask before killing it.

### Source-Backed Failure Patterns

- Official CLI docs provide `--exact-port`, `--smoke-test`, `--ci`, `--no-open`,
  `--debug`, `--debug-webpack`, `--stats-json`, `storybook doctor`, and
  `storybook info`.
- Official migration docs route upgraded projects through `storybook doctor`,
  `build` for clearer failures, migration notes, addon isolation, and version
  bisection.
- Official test-runner docs say tests require a running Storybook, use
  Playwright/Jest, can reduce worker count, can increase test timeout, can clear
  cache, and can target a URL.
- GitHub issue research shows repeated hang causes from inherited Vite plugins,
  module federation, long transform stages, heap pressure, readiness races, and
  fatal browser/test crashes.

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
- Storybook CLI options: `https://storybook.js.org/docs/api/cli-options`.
- Storybook migration troubleshooting:
  `https://storybook.js.org/docs/releases/migration-guide#troubleshooting`.
- Storybook test runner troubleshooting:
  `https://storybook.js.org/docs/writing-tests/integrations/test-runner#troubleshooting`.
- Storybook issue research: `https://github.com/storybookjs/storybook/issues`.
- Storybook test-runner issue research:
  `https://github.com/storybookjs/test-runner/issues`.
