---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
---

# Browser Use

Use for browser tasks that need a logged-in, profile-bearing Chrome session.

## Owner

- Warm Chrome proof, repair, launch: `skills/browser-use/scripts/preflight-warm-chrome.sh`.
- Browser Adapter Proof: `skills/browser-use/scripts/preflight-browser-adapter.sh`.
- Browser Adapter Router: `skills/browser-use/scripts/browser-adapter-router.sh`.
- Browser Use targets and operations: `skills/browser-use/scripts/browser-use.sh` (route-bound; run Router `prepare` then `route` first).
- Browser Adapter Map validation: `skills/browser-use/scripts/browser-adapter-map.sh`.
- CLI contracts, flags, env vars, result vocab, actions: `skills/browser-use/scripts/command-contract.ts`.
- Router model, validation, recovery: `skills/browser-use/scripts/browser-adapter-router*.ts`.
- Warm Chrome invariant and auth boundary: `skills/browser-use/references/warm-chrome.md`.
- Browser Adapter Maps: `skills/browser-use/references/browser-adapter-*.md`.

## Workflow

Name the browser outcome before choosing tools:

- Map the user request to a Router bundle or required capabilities.
- Set route policy from the request: auto, prefer, or force.
- Treat auth/session and target-origin checks as route preconditions when the task needs them.

Prove Warm Chrome as the browser-entry precondition:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --json
```

- Parse stdout envelope.
- Follow `continuation.next_action_id`.
- Obey `continuation.constraints`; skip adapter fallback and cold-browser fallback when forbidden.
- Use `repair` or `launch` only when browser entry is approved or requested.

Ask the Router for capability evidence, then route:

```bash
skills/browser-use/scripts/browser-adapter-router.sh report --adapter <id> --json
skills/browser-use/scripts/browser-adapter-router.sh route --envelope "$ENVELOPE" --json
```

- Build the route envelope from the user request, Warm Chrome proof, task preconditions, and capability reports.
- Let `route` select the adapter or fail closed.
- Follow the Router continuation.
- Treat Router alternatives as informational unless the Router selects them.

If Router asks for attachment proof:

```bash
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter <selected-or-requested-adapter> --json
skills/browser-use/scripts/browser-adapter-router.sh route --envelope "$UPDATED_ENVELOPE" --json
```

- Let the selected adapter proof own dependency checks, config checks, port binding, and repair hints.
- Read the selected Browser Adapter Map for adapter-local inspection or repair commands.
- Add fresh proof evidence to the route envelope, then reroute.
- Continue only after Router emits `use_selected_browser_adapter`.
- A login/MFA wall hit after preflight passes is an app step in the warm profile.

Use `status` for human route projection:

```bash
skills/browser-use/scripts/browser-adapter-router.sh status --envelope "$ENVELOPE" --plain
```

After route success, list Browser Target Candidates through the proven adapter:

```bash
skills/browser-use/scripts/browser-use.sh targets list --mode route-bound --route "$ROUTE" --adapter-proof "$PROOF" --json
```

- Route-bound listing yields operation-ready candidates; recovery listing (`--mode recovery` with a requested adapter instead of a route) yields evidence-gathering candidates for `prepare --target-discovery`.
- Reference targets by candidate ordinal; ordinals are scoped to one target envelope.
- Use `--show-url` for origin plus redacted path shape only; never expect query strings, fragments, or adapter handles in output.
- Follow `continuation.next_action_id`: route-bound points at `targets select`, recovery at `prepare`.
- Modes, flags, result vocab, and recovery actions: `skills/browser-use/scripts/command-contract.ts`.

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
