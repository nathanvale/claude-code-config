---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
role: tool-workflow
---

# Browser Use

Use for browser entry, inspection, navigation, target discovery, and page actions through Warm Chrome.

## Owner

- Repo-local front doors: `skills/browser-use/package.json#scripts`.
- Installed front doors: `skills/browser-use/package.json#bin`.
- Warm Chrome proof, repair, launch: `preflight-warm-chrome`.
- Warm browser stack front door: `browser-use warm start`.
- Browser Adapter Proof: `preflight-browser-adapter`.
- Browser Adapter Router CLI: `skills/browser-use/src/browser-adapter-router.ts`.
- Browser Adapter Router model: `skills/browser-use/src/browser-adapter-router-model.ts`.
- Browser Adapter Router engine: `skills/browser-use/src/browser-adapter-router-engine.ts`.
- Browser Adapter Router discovery: `skills/browser-use/src/browser-adapter-router-discovery.ts`.
- Browser Adapter Router validation and recovery: `skills/browser-use/src/browser-adapter-router-validation.ts`, `skills/browser-use/src/browser-adapter-router-recovery.ts`.
- Browser Adapter Router tests: `skills/browser-use/src/browser-adapter-router.test.ts`.
- Browser Use warm start, targets, and operations: `browser-use`.
- Browser Adapter Map validation: `browser-adapter-map`.
- CLI contracts, flags, env vars, result vocab, actions: `skills/browser-use/src/command-contract.ts`.
- Warm Chrome invariant and auth boundary: `skills/browser-use/references/warm-chrome.md`.
- Chrome DevTools adapter map: `skills/browser-use/references/browser-adapter-chrome-devtools.md`.
- Coding Task Tracker workflow: `skills/browser-use/references/coding-task-tracker.md`.

## Invocation Forms

- Repo-local workflow: run `bun run <command>` from `skills/browser-use`; this executes `src`.
- Repo-root verification: run `bun run check:workspace-facade`; this rebuilds `dist` before invariant checks.
- Package verification: run `bun --filter browser-use-scripts <script>` from the repo root.
- Installed usage: call bare command names from `package.json#bin`.
- Command contracts name command identity only; omit `bun run`, `src`, `dist`, and repo paths.

## Workflow

Name the browser outcome before choosing tools:

- For browser-use project work, read `skills/browser-use/references/coding-task-tracker.md` before choosing or updating a tracker task.
- Use repo-local commands while working from this repo.
- Choose one run id before proof work; reuse it for Warm Chrome, Adapter Proof, Router, target state, and page actions.
- Map the user request to a Router bundle or required capabilities.
- Set route policy from the request: auto, prefer, or force.
- Treat auth/session and target-origin checks as route preconditions when the task needs them.
- Use current command help for exact flags, file inputs, output modes, and recovery meanings.

Start browser work through the warm front door:

1. `browser-use warm start --json` → Warm Chrome + `chrome-devtools` readiness envelope.
2. Follow `continuation.next_action_id`.
3. If ready, continue with Router evidence and page target work.
4. If stale selected `mcporter` config is reported, use `--repair-adapter-config` only when config repair is approved for this run.
5. If diagnostics are requested, inspect Adapter Proof output before browser action.

Route through the Router continuation chain after the warm stack is ready:

1. `browser-adapter-router report` → Adapter capability report artifact.
2. `browser-adapter-router prepare` (supply proof + report + task preconditions) → route-evidence envelope.
3. `browser-adapter-router route` (supply envelope) → route artifact. Follow `use_selected_browser_adapter`.
4. If Router asks for attachment proof: `preflight-browser-adapter check --adapter <id>` → Adapter Proof artifact, then rerun `prepare` + `route` with fresh proof.
5. Use `browser-adapter-router report` for human-readable capability projection until Router status is shipped.

Exact flags and env vars: run `<command> --help` or read `skills/browser-use/src/command-contract.ts`. Follow each command's `continuation.next_action_id`; obey `continuation.constraints` — skip adapter fallback and cold-browser fallback when forbidden.

Continuation precedence: a hard preflight failure governs; only then does a `continuation.next_action_id` apply. A login/MFA wall hit after preflight passes is an app step in the warm profile, not a preflight failure — keep driving the page.

After route success, list and select Browser Target Candidates through the proven adapter:

- Run `browser-use targets list` in route-bound mode with the route artifact and Adapter Proof artifact.
- Save stdout as the route-bound target-list artifact.
- Run `browser-use targets select`; pipe or pass the target-list artifact, choose a candidate or hint, and write run-scoped target state.
- Route-bound listing yields operation-ready candidates; recovery listing yields evidence-gathering candidates for target discovery.
- Follow `continuation.next_action_id` to the next command.
- Modes, flags, candidate referencing, URL redaction, result vocab, and recovery actions: `skills/browser-use/src/command-contract.ts`.

## Verification

- Run `bun --filter browser-use-scripts build` after package bin or distribution edits.
- Run `bun --filter browser-use-scripts pack:dry-run` before publishing or reviewing package payload changes.
- Run `bun --filter browser-use-scripts test` after router, adapter-map, preflight, or browser-use script changes.
- Run `bun --filter browser-use-scripts typecheck` after TypeScript edits.
- Run `cd skills/browser-use`, then `bun run preflight-warm-chrome check --json` only when verifying local Warm Chrome behavior.

## Page Actions

- Use `browser-use operate` after route success and adapter proof.
- Let `browser-use operate` enforce route binding, target state, and operation capability checks.
- Use `browser-use operate --help` and current snapshot output for action syntax.
- Let the selected adapter own its dependencies and transport.
- Re-snapshot before element-ref actions.
- Treat refs as stale after navigation or DOM-changing actions.
- Take screenshots only when visual layout, media proof, or user request needs them.

## Safety

- Keep Warm Chrome on a real Google Chrome binary, a dedicated persistent profile, and loopback CDP.
- Do not use Chrome for Testing, throwaway profiles, everyday default profiles, isolated Playwright launch, Puppeteer launch, AppleScript, `osascript`, macOS `open`, or cold-browser fallback as substitutes.
- Do not print tokens, passwords, cookies, auth-bearing URLs, raw network secrets, or sensitive input values.
- Report secret checks by shape only: present/absent, length, status code, account/org name.

## Next Safe Action

- Blocked on Warm Chrome: run `preflight-warm-chrome check --json`; follow `continuation.next_action_id` (`repair` or `launch` only when approved).
- Starting browser work: run `browser-use warm start --json`; follow `continuation.next_action_id`.
- Blocked on routing: run `browser-adapter-router report --adapter <id> --json`; if capability gaps, research then re-prove; if binding mismatch, rerun `preflight-browser-adapter check`.
- Blocked on targets: run `browser-use targets list --mode recovery --adapter <id> --adapter-proof <path> --json`; follow `continuation.next_action_id`.
- Unknown failure: read the JSON envelope `error.code` against the diagnostic codes in `skills/browser-use/src/command-contract.ts`; each code names its own recovery action.
