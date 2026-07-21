---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
role: tool-workflow
---

# Browser Use

Use for browser target discovery, selection, and page operations against a
proven browser connection. Connection is delegated: `runtime/browser-connect`
proves Agent Chrome and attaches the adapter; browser-use owns operational
policy after the handoff — adapter choice, targets, operate, auth boundary,
safety.

## Owner

- Browser connection (prove + attach; Verified Handoff Envelope; repair paths): `runtime/browser-connect` (`@side-quest/browser-connect`). Commands, flags, exit codes: `runtime/browser-connect/src/command-contract.ts`; repair procedures: `runtime/browser-connect/REPAIR.md`; see `CONTEXT-MAP.md` (Browser Use → browser-connect).
- Targets and operations: CLI contracts, flags, modes, env vars, result vocab, diagnostic codes: `skills/browser-use/src/command-contract.ts`.
- Repo-local front doors: `skills/browser-use/package.json#scripts`. Installed front doors: `skills/browser-use/package.json#bin`.
- Warm Chrome invariant and auth boundary: `skills/browser-use/references/warm-chrome.md`.
- Coding Task Tracker workflow: `skills/browser-use/references/coding-task-tracker.md`.

## Invocation Forms

- Installed bins (primary from any CWD): `browser-connect`, `browser-use`, and `warm-chrome` resolve on PATH as setup-owned `~/.bun/bin` symlinks into the source repo. `setup sync` installs and repairs them; `setup status` verifies. Agents outside the repo use these, never repo-relative paths.
- browser-use repo-local: run `bun run browser-use <command>` from `skills/browser-use`; this executes `src`.
- browser-connect repo-local: run `bun run runtime/browser-connect/src/cli.ts <args>` from the repo root.
- Repo-root verification: run `bun run check:workspace-facade`; this rebuilds `dist` before invariant checks.
- Command contracts name command identity only; omit `bun run`, `src`, `dist`, and repo paths.

## Engine Lanes

Read the domain file's `engine` before connecting; it selects the adapter and the operating surface:

- `engine: agent-browser`: connect with `browser-connect connect agent-browser --json`, then drive the agent-browser CLI directly (`eval`, `click`, `fill`, domain scripts). `targets`/`operate` does not apply to this lane.
- No engine declared, or `chrome-devtools-mcp`: connect with `browser-connect connect chrome-devtools-mcp --json` and follow the Workflow below (`targets list → targets select → operate`).
- Adapter ids come from the registered enum in `skills/browser-use/src/command-contract.ts`; never abbreviate them.

## Workflow

Name the browser outcome, then connect once and operate:

- For browser-use project work, read `skills/browser-use/references/coding-task-tracker.md` before choosing or updating a tracker task.
- Choose one run id. Pass it as `--run-id` on the browser-connect command, and export `BROWSER_USE_RUN_ID=<run-id>` plus `BROWSER_USE_TARGET_STATE_DIR=<dir>` for the browser-use commands (or pass `--state <path>` explicitly on select/status/operate). The envelope carries the run id into each command's binding; the state path needs the explicit run id or `--state` — select fails closed with `target_selection_state_path_missing` otherwise.
- Wrapped-tool outcome: `browser-connect run <adapter> -- <cmd>` proves the connection, injects the verified endpoint, and execs the command (envelope on stderr pre-exec; exit passthrough).
- browser-use outcome: `browser-connect connect <adapter> --json` mints the Verified Handoff Envelope on stdout; save it.
- Discover: `browser-use targets list --mode handoff-bound --handoff <envelope> --json`; save the success envelope. Handoff-bound listing yields operation-ready candidates; recovery listing yields evidence-gathering candidates.
- Select: pipe the handoff-bound list envelope into `browser-use targets select`; choose a candidate or hint; it writes run-scoped target state.
- Operate: `browser-use operate <snapshot|screenshot|emulate>` against the selected target.
- Adapter identity is the envelope's `attachment.adapter_id` verbatim (one vocabulary across the seam); per-adapter operation capabilities: `skills/browser-use/src/command-contract.ts`.
- Live discovery/operate calls derive the adapter binary and endpoint from the envelope (`attachment.probe_executable` + `endpoint.http`); `~/.config/mcporter/mcporter.json` server entries are never consulted.
- Treat auth/session and target-origin checks as operation preconditions when the task needs them; resolve login secrets through the domain's Auth Pointer at runtime, never inline secret values.
- Use current command help for exact flags, file inputs, output modes, and recovery meanings. Follow each command's `continuation.next_action_id`; obey `continuation.constraints` — skip adapter fallback and cold-browser fallback when forbidden.

Continuation precedence: a hard preflight failure governs; only then does a `continuation.next_action_id` apply. A login/MFA wall hit after preflight passes is an app step in the warm profile, not a preflight failure — keep driving the page.

## Page Actions

Every page action runs one lifecycle inside a single adapter's native continuity: **observe → name the postcondition and resolve the current ref → mutate → verify fresh structure**. The adapter selects the surface; browser use is never inherently MCP-based.

Bind every element ref to the adapter, interaction context, browser target, and observed page state that produced it. A ref is valid only inside the continuity that minted it.

**agent-browser lane** — native CLI, not MCP. Keep observe, mutate, and verify in one explicit native session, against the verified endpoint (envelope `endpoint.ws`, injected via `--cdp`), and one explicitly selected active tab. Drive the agent-browser CLI directly. agent-browser has been measured reporting success on a stale-ref click while the page did not change (2026-06-13 research; current builds may hard-error instead), so its return text never decides the outcome.

**chrome-devtools-mcp lane** — keep the ref-producing observation, the mutation, and the fresh verification in one MCP client and server process, against one explicitly selected page. Its refs are process-scoped, so a replacement client never reuses a prior ref. `browser-use operate` starts a fresh adapter process per call and ships only `snapshot`, `screenshot`, `emulate` — never carry an `operate snapshot` ref into a separate mutation client.

Discard the old ref and observe again after: navigation, any DOM-changing action, client or process restart, native session change, endpoint change, or target/tab change. If an adapter owner publishes no documented continuity contract, treat ref mutation as unsupported — never infer MCP or CLI semantics.

**Decide completion from structure, not output.** Before a mutating action, name one task-specific structural postcondition: expected URL, scoped DOM or accessibility structure, element presence or absence, a control value or state, or persisted target data. Choose a shape the action's failure path cannot also produce — for a submit, save, or send, prefer persisted target data or success-distinct structure; a shared return URL or a disappearing control confirms nothing. After mutating, obtain fresh structural state through the same continuity (a fresh snapshot, or a scoped structural read such as the page URL); treat adapter return text and ambient keywords as supporting evidence only. Classify:

- **confirmed** — the expected structure is present.
- **not achieved** — no effect is proven: the adapter rejected the action, or absence is proven at the persisted target. For a submit, save, or send, an unchanged page alone never proves no effect — the mutation can commit server-side or land off-page; classify `unknown` instead.
- **unknown** — evidence is partial, unrelated, or insufficient.

On `unknown`, inspect; do not automatically repeat the mutation. Retry an externally-effecting mutation only when no effect is proven at the target (never from an unchanged page alone) and the repetition is known safe.

Take screenshots only when visual layout, media proof, or user request needs them.

## Safety

- Keep Warm Chrome on a real Google Chrome binary, a dedicated persistent profile, and loopback CDP.
- Do not use Chrome for Testing, throwaway profiles, everyday default profiles, isolated Playwright launch, Puppeteer launch, AppleScript, `osascript`, macOS `open`, or cold-browser fallback as substitutes.
- No convention endpoints: never hardcode `http://127.0.0.1:9222`; use the verified endpoint from the browser-connect envelope verbatim.
- Never mass-kill by port; listener remediation is operator-owned (`runtime/browser-connect/REPAIR.md#v1-inspect_listener`).
- Do not print tokens, passwords, cookies, auth-bearing URLs, raw network secrets, or sensitive input values.
- Report secret checks by shape only: present/absent, length, status code, account/org name.

## Verification

- Run `bun --filter browser-use-scripts test` after browser-use script changes.
- Run `bun --filter browser-use-scripts typecheck` after TypeScript edits.
- Run `bun --filter browser-use-scripts build` after package bin or distribution edits.
- Run `bun --filter browser-use-scripts pack:dry-run` before publishing or reviewing package payload changes.

## Next Safe Action

- Connection failed (exit `20`, fail closed): the failure envelope carries exactly one Repair Path with an anchor into `runtime/browser-connect/REPAIR.md` — follow that anchor. Never fall back to a cold or headless browser; never retry the convention port.
- Agent Chrome stopped: rerun `browser-connect connect <adapter> --json`; the prove-or-launch gate owns the launch (`runtime/browser-connect/REPAIR.md#v1-launch_agent_chrome`).
- Foreign listener on the port: a verified-free suggested port allows exactly one fresh rerun (`runtime/browser-connect/REPAIR.md#v1-use_suggested_port`); otherwise operator inspection (`runtime/browser-connect/REPAIR.md#v1-inspect_listener`).
- Adapter not installed: `browser-connect repair-adapter <adapter> --check --json` to preview, `--execute` to repair (`runtime/browser-connect/REPAIR.md#v1-install_adapter`).
- Attachment probe failed: reproduce with `browser-connect connect <adapter> --json --verbose --run-id <run_id>` (`runtime/browser-connect/REPAIR.md#v1-inspect_attachment_probe`).
- Untyped or unknown connection failure: `browser-connect check --json --verbose --run-id <run_id>` (`runtime/browser-connect/REPAIR.md#v1-inspect_diagnostics`).
- Blocked on targets or handoff evidence (invalid, stale, run-id mismatch): mint a fresh envelope with `browser-connect connect <adapter> --json`, then re-run `browser-use targets list --mode handoff-bound --handoff <path> --json`; for evidence-gathering discovery use `--mode recovery --adapter <id> --handoff <path>` (recovery-mode live listing needs a verified envelope — without one it fails closed with `supply_verified_handoff`; `chrome-devtools-mcp` is the implemented discovery/operation transport; the full adapter enum lives in `skills/browser-use/src/command-contract.ts`).
- Unknown browser-use failure: read the JSON envelope `error.code` against the diagnostic codes in `skills/browser-use/src/command-contract.ts`; each code names its own recovery action.
