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
- Browser Adapter Proof: `preflight-browser-adapter`.
- Browser Adapter Router CLI: `skills/browser-use/src/browser-adapter-router.ts`.
- Browser Adapter Router model: `skills/browser-use/src/browser-adapter-router-model.ts`.
- Browser Adapter Router engine: `skills/browser-use/src/browser-adapter-router-engine.ts`.
- Browser Adapter Router discovery: `skills/browser-use/src/browser-adapter-router-discovery.ts`.
- Browser Adapter Router validation and recovery: `skills/browser-use/src/browser-adapter-router-validation.ts`, `skills/browser-use/src/browser-adapter-router-recovery.ts`.
- Browser Adapter Router tests: `skills/browser-use/src/browser-adapter-router.test.ts`.
- Browser Use targets and operations: `browser-use` (route-bound; run Router `prepare` then `route` first).
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

Prove Warm Chrome as the browser-entry precondition:

- Run `preflight-warm-chrome check`.
- Save stdout as the Warm Chrome proof artifact.
- Parse stdout envelope.
- Follow `continuation.next_action_id`.
- Obey `continuation.constraints`; skip adapter fallback and cold-browser fallback when forbidden.
- Use `repair` or `launch` only when browser entry is approved or requested.

Ask the Router for capability evidence, prepare route evidence, then route:

- Run `browser-adapter-router report`; save stdout as the Adapter capability report artifact.
- Run `browser-adapter-router prepare`; supply the Warm Chrome proof, Adapter capability report, and task preconditions.
- Save `prepare` stdout as the prepared route-evidence artifact.
- Run `browser-adapter-router route`; supply the prepared route-evidence artifact.
- Save route success stdout as the route artifact.
- Build `prepare` inputs from the user request, Warm Chrome proof, task preconditions, and capability reports.
- Let `prepare` assemble the route envelope.
- Pass the prepared envelope to `route`.
- Let `route` select the adapter or fail closed.
- Follow the Router continuation.
- Treat Router alternatives as informational unless the Router selects them.

If Router asks for attachment proof:

- Run `preflight-browser-adapter check` with the selected adapter, verified Warm Chrome endpoint or port, and the same run id.
- Save stdout as the Adapter Proof artifact.
- Rerun `browser-adapter-router prepare` with Warm Chrome proof, Adapter Proof, Adapter capability report, and task preconditions.
- Rerun `browser-adapter-router route` with the new prepared route-evidence artifact.
- Let the selected adapter proof own dependency checks, config checks, port binding, and repair hints.
- Read the selected Browser Adapter Map for adapter-local inspection or repair commands.
- Add fresh proof evidence to the route envelope, then reroute.
- Continue only after Router emits `use_selected_browser_adapter`.
- A login/MFA wall hit after preflight passes is an app step in the warm profile.

Use `status` on prepared evidence for human route projection:

- Run `browser-adapter-router status` against the prepared route-evidence artifact.

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
