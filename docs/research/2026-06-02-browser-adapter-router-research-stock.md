---
date: 2026-06-02
topic: browser-use Browser Adapter Router
type: research-stock
status: source-evidence
related:
  - docs/plans/2026-06-02-004-design-browser-use-adapter-router-plan.md
  - docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md
  - prototypes/browser-adapter-router/research.html
---

# Browser Adapter Router Research Stock

Purpose: compact research inventory for continuing the `browser-use` Browser Adapter Router plan.

## Sources

- Context7 Playwright MCP:
  - `https://context7.com/microsoft/playwright-mcp/llms.txt?tokens=10000`
- Context7 Chrome DevTools MCP:
  - `https://context7.com/chromedevtools/chrome-devtools-mcp/llms.txt?tokens=10000`
- Context7 Agent Browser:
  - `https://context7.com/vercel-labs/agent-browser/llms.txt?tokens=10000`
- GitHub Playwright MCP:
  - `https://github.com/microsoft/playwright-mcp`
- GitHub Chrome DevTools MCP tool reference:
  - `https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md`
- GitHub Agent Browser:
  - `https://github.com/vercel-labs/agent-browser`

## Research Status

- This is source evidence for a prototype and plan.
- It is not a runtime capability report.
- The accepted plan and ADR own decisions after grilling.
- Runtime reports still need provenance:
  - adapter version
  - source URL
  - checked date
  - verification method
  - confidence
  - stale-after policy

## Context7 Refresh Notes

Fresh Context7 pass on 2026-06-02:

- Playwright MCP:
  - Tool list includes browser click, drag, evaluate, fill form, hover, type, tabs, snapshot, screenshot, console messages, network requests, network request detail, resize.
  - Capability type surface includes `core`, `network`, `pdf`, `storage`, `testing`, `vision`, `devtools`.
  - `browser_storage_state` documents cookies/localStorage export.
  - Network state can be set online/offline.
- Chrome DevTools MCP:
  - Docs position it as Chrome DevTools for agents over MCP/CLI.
  - Tool categories include input automation, navigation automation, emulation, performance, network, debugging, memory, extensions, third-party, WebMCP.
  - Documented examples include `click` and `list_console_messages`.
  - Prototype additionally references tool-reference entries for performance, network, memory, Lighthouse, screenshots, and snapshots.
- Agent Browser:
  - Core CLI documents open/navigate, click, fill, type, press, hover, focus, select, check/uncheck, scroll, drag, upload, screenshot, PDF, snapshot, eval, CDP connect, streaming, close.
  - Element actions can use refs from snapshot, CSS selectors, or semantic locators.
  - React/Web Vitals commands exist: `react tree`, `react inspect`, `react renders`, `react suspense`, `vitals`.
  - Auth state commands exist: `state save`, `state load`, `state list`, `state show`, `state rename`, `state clear`, `state clean`.
  - Snapshot/screenshot diff commands exist.

## Prototype Capability Matrix

Source:

- `/Users/nathanvale/code/claude-code-config/prototypes/browser-adapter-router/research.html`

Capability states in prototype:

- `full`: direct documented support.
- `partial`: weaker/adjacent support.
- `none`: no direct capability found in docs used for this pass.

Chrome DevTools MCP:

- `snapshot_refs`: full; evidence `take_snapshot`.
- `auth_session`: full; Warm Chrome profile and selected page.
- `element_actions`: full; click, fill, fill_form, drag, upload_file.
- `selector_actions`: partial; UID-first, coordinate click exists.
- `screenshot_media`: full; take_screenshot, experimental screencast.
- `console_debug`: full; list_console_messages, get_console_message.
- `network_inspection`: full; list_network_requests, get_network_request.
- `performance_profile`: full; performance_start_trace, performance_stop_trace.
- `devtools_performance_insight`: full; performance_analyze_insight.
- `storage_state`: partial; possible through evaluate_script.
- `emulation`: full; emulate, resize_page.
- `memory_debug`: full; heap snapshot tools.
- `lighthouse_audit`: full; lighthouse_audit.
- `react_vitals`: none; not native.

Playwright MCP:

- `snapshot_refs`: full; browser_snapshot.
- `auth_session`: partial; storageState/context config, not current user Chrome by default.
- `element_actions`: full; browser_click, browser_fill_form, browser_type.
- `selector_actions`: full; target refs/selectors, mouse xy tools.
- `screenshot_media`: full; browser_take_screenshot, video tools.
- `console_debug`: full; browser_console_messages.
- `network_inspection`: full; browser_network_requests, browser_network_request, routes.
- `performance_profile`: partial; browser_start_tracing, browser_stop_tracing.
- `devtools_performance_insight`: none; not found.
- `storage_state`: full; localStorage/sessionStorage tools.
- `emulation`: partial; resize and context config.
- `memory_debug`: none; not found.
- `lighthouse_audit`: none; not found.
- `react_vitals`: none; not found.

Agent Browser CLI:

- `snapshot_refs`: full; snapshot with refs.
- `auth_session`: full; profile/session/auth commands.
- `element_actions`: full; click, fill, type, press, drag, upload.
- `selector_actions`: full; refs, CSS, XPath, semantic locators.
- `screenshot_media`: full; screenshot, PDF, record.
- `console_debug`: full; console, errors.
- `network_inspection`: full; network HAR, route/intercept.
- `performance_profile`: full; profiler, trace, vitals.
- `devtools_performance_insight`: none; not found.
- `storage_state`: full; cookies, storage, state, auth.
- `emulation`: partial; launch args, user-agent, provider options.
- `memory_debug`: none; not found.
- `lighthouse_audit`: none; not found.
- `react_vitals`: full; react tree/renders, vitals.

## Prototype Actions

- `timesheet`:
  - request: `browser-use timesheet --site Manpower --range last-week`
  - bundle: auth session, snapshot refs, element actions, screenshot/media.
  - priority: Agent Browser, Chrome DevTools MCP, Playwright MCP.
- `webProfile`:
  - request: `browser-use debug-profile --target localhost`
  - bundle: performance profile, network inspection, console debugging.
  - priority: Chrome DevTools MCP, Agent Browser, Playwright MCP.
- `reactVitals`:
  - request: `browser-use react-vitals --target app`
  - bundle: React/Web Vitals, performance profile, console debugging.
  - priority: Agent Browser, Chrome DevTools MCP, Playwright MCP.
- `heap`:
  - request: `browser-use memory-snapshot`
  - bundle: memory debugging.
  - priority: Chrome DevTools MCP, Agent Browser, Playwright MCP.

## Historical Prototype Gap

- Earlier prototype logic treated any non-`none` bundle as routable.
- Current Router plan and prototype model `partial` as fail-closed by default.
- Runtime implementation still owns executable truth.

## Historical Recovery Shape

Early prototype failure output demonstrated:

- `error.code = "adapter_capability_missing"`
- `requested_adapter`
- `required_capabilities`
- `missing_capabilities`
- `suggested_adapter`
- `runtime_actions[0].id = "change_adapter_or_action"`
- `runtime_actions[1].id = "research_adapter_capability"`
- `runtime_actions[1].hint.context7.query`
- `continuation.next_action_id = "change_adapter_or_action"`

The accepted Router plan supersedes this recovery sketch.

## Research Questions For Next Pass

- Can each adapter expose capability reports itself, or do we need manifests until adapter CLIs support it?
- What is the smallest report contract that can represent `full`, `partial`, `none`, `unknown`, and `stale`?
- How does `browser-use` refresh stale capability data without treating docs lookup as proof?
- Which capabilities are preconditions rather than adapter capabilities?
- What ranking rules apply when multiple adapters report full support?
- Where should provenance live so skill prose stays lean?
