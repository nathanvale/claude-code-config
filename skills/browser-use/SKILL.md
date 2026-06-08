---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
role: tool-workflow
---

# Browser Use

Use for browser tasks that need a logged-in, profile-bearing Chrome session.

## Owner

- Front doors: `skills/browser-use/package.json#bin`.
- Warm Chrome proof, repair, launch: `preflight-warm-chrome`.
- Browser Adapter Proof: `preflight-browser-adapter`.
- Browser Adapter Router: `browser-adapter-router`.
- Browser Use targets and operations: `browser-use` (route-bound; run Router `prepare` then `route` first).
- Browser Adapter Map validation: `browser-adapter-map`.
- CLI contracts, flags, env vars, result vocab, actions: `skills/browser-use/src/command-contract.ts`.
- Router model, validation, recovery: `skills/browser-use/src/browser-adapter-router*.ts`.
- Warm Chrome invariant and auth boundary: `skills/browser-use/references/warm-chrome.md`.
- Chrome DevTools adapter map: `skills/browser-use/references/browser-adapter-chrome-devtools.md`.

## Workflow

Name the browser outcome before choosing tools:

- Map the user request to a Router bundle or required capabilities.
- Set route policy from the request: auto, prefer, or force.
- Treat auth/session and target-origin checks as route preconditions when the task needs them.

Prove Warm Chrome as the browser-entry precondition:

```bash
cd skills/browser-use
bun run preflight-warm-chrome check --json
```

- Parse stdout envelope.
- Follow `continuation.next_action_id`.
- Obey `continuation.constraints`; skip adapter fallback and cold-browser fallback when forbidden.
- Use `repair` or `launch` only when browser entry is approved or requested.

Ask the Router for capability evidence, then route:

```bash
cd skills/browser-use
bun run browser-adapter-router report --adapter <id> --json
bun run browser-adapter-router route --envelope "$ENVELOPE" --json
```

- Build the route envelope from the user request, Warm Chrome proof, task preconditions, and capability reports.
- Let `route` select the adapter or fail closed.
- Follow the Router continuation.
- Treat Router alternatives as informational unless the Router selects them.

If Router asks for attachment proof:

```bash
cd skills/browser-use
bun run preflight-browser-adapter check --adapter <selected-or-requested-adapter> --json
bun run browser-adapter-router route --envelope "$UPDATED_ENVELOPE" --json
```

- Let the selected adapter proof own dependency checks, config checks, port binding, and repair hints.
- Read the selected Browser Adapter Map for adapter-local inspection or repair commands.
- Add fresh proof evidence to the route envelope, then reroute.
- Continue only after Router emits `use_selected_browser_adapter`.
- A login/MFA wall hit after preflight passes is an app step in the warm profile.

Use `status` for human route projection:

```bash
cd skills/browser-use
bun run browser-adapter-router status --envelope "$ENVELOPE" --plain
```

After route success, list Browser Target Candidates through the proven adapter:

```bash
cd skills/browser-use
bun run browser-use targets list --mode route-bound --route "$ROUTE" --adapter-proof "$PROOF" --json
```

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

- Use the selected adapter after proof.
- Let the selected adapter own its action surface and dependencies.
- Use the adapter's current help and snapshot output for action syntax.
- Re-snapshot before element-ref actions.
- Treat refs as stale after navigation or DOM-changing actions.
- Take screenshots only when visual layout, media proof, or user request needs them.

## Safety

- Keep Warm Chrome on a real Google Chrome binary, a dedicated persistent profile, and loopback CDP.
- Do not use Chrome for Testing, throwaway profiles, everyday default profiles, isolated Playwright launch, Puppeteer launch, AppleScript, `osascript`, macOS `open`, or cold-browser fallback as substitutes.
- Do not print tokens, passwords, cookies, auth-bearing URLs, raw network secrets, or sensitive input values.
- Report secret checks by shape only: present/absent, length, status code, account/org name.
