---
name: browser-use
description: "Route browser work through Warm Chrome Preflight and a real Chrome CDP adapter. No Chrome for Testing."
---

# Browser Use

Use for browser tasks that need a logged-in, profile-bearing Chrome session.

## Contract

- Owner: `browser-use` owns Warm Chrome readiness, repair, launch, and adapter routing.
- Warm Chrome: real Google Chrome binary, dedicated persistent profile, loopback CDP.
- Never Chrome for Testing. Never throwaway profile. Never everyday default profile.
- `browser-domain-memory`, runbooks, and adapters consume preflight proof; they do not own readiness policy.
- Details: `references/warm-chrome.md`.
- MCP config repair: `mcporter-config.md`.

## Proof Flow

Before adapter action:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
```

- Parse stdout envelope. Treat stderr as diagnostics only.
- Warm Chrome Preflight success: follow `continuation.next_action_id`; candidate endpoint is verified.
- Browser Adapter Proof success: follow `continuation.next_action_id`; selected adapter is verified.
- Failure: follow `continuation.next_action_id`; inspect `runtime_actions` for that action's summary and side effects.
- Obey `continuation.constraints` before choosing adapters; `forbidden_action_ids` are behaviours to skip, not `runtime_actions` ids to look up.
- Browser Entry Handoff constraint stops adapter fallback and cold-browser fallback. Repair Warm Chrome, then rerun.
- Browser Adapter Proof constraint also stops adapter fallback and cold-browser fallback. Inspect or update adapter config, then rerun.
- A login/MFA wall hit after preflight passes is an app step, not browser entry: complete it in the warm profile, do not rerun preflight.
- Use `repair` or `launch` only when explicitly preparing Warm Chrome entry.
- Contract owner: `skills/browser-use/scripts/command-contract.ts`.
- Precedence and auth boundary: `references/warm-chrome.md`.

Human health:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh status --port "$PORT" --plain
```

Repair/launch, when browser entry is approved:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh repair --port "$PORT" --profile "$PROFILE" --plain
skills/browser-use/scripts/preflight-warm-chrome.sh launch --port "$PORT" --profile "$PROFILE" --plain
```

Observability:

```bash
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --debug --run-id "$RUN_ID"
skills/browser-use/scripts/preflight-warm-chrome.sh check --port "$PORT" --json --quiet
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json --run-id "$RUN_ID"
```

- `--debug`: LogTape JSONL breadcrumbs on stderr.
- `--quiet`: suppress diagnostics; keep stdout envelope.
- Use `--run-id` or `BROWSER_USE_RUN_ID` for cross-tool correlation.

## Browser Adapter Router

`browser-use` owns adapter selection. The Router ranks proven candidates from supplied evidence; it never infers from preference, docs familiarity, or adapter folklore. Capability truth is runtime discovery data, not skill prose.

V1 sequence for one Bounded Browser Outcome:

1. Warm Chrome Preflight: browser-entry proof (`preflight-warm-chrome.sh check`).
2. Browser Adapter Proof: per-candidate attachment proof (`preflight-browser-adapter.sh check`).
3. Router report: validated capability report per candidate (`browser-adapter-router.sh report`).
4. Caller-assembled evidence envelope: skill driver assembles proof, reports, task preconditions, and policy into one JSON envelope.
5. Router route: `browser-adapter-router.sh route` selects an adapter or fails closed (`browser-adapter-router.sh status` projects the same decision for humans).

```bash
skills/browser-use/scripts/browser-adapter-router.sh report --adapter chrome-devtools --json
skills/browser-use/scripts/browser-adapter-router.sh route --envelope "$ENVELOPE" --json
skills/browser-use/scripts/browser-adapter-router.sh status --envelope "$ENVELOPE" --plain
```

- `route` consumes the envelope only; it never invokes proof, runs self-report commands, or reads implicit latest files. Supply the envelope via `--envelope <path>`, `BROWSER_USE_ROUTER_ENVELOPE_JSON`, or piped stdin (never an interactive terminal).
- `BROWSER_USE_ROUTER_SELF_REPORT_JSON`: inject a fresh capability report object for `report`; `BROWSER_USE_ROUTER_EVAL_DATE`: pin the freshness evaluation date (defaults to today).
- Registry membership (`chrome-devtools`, `agent-browser`, `playwright-cdp`) is known adapter identity, not routability; current support comes from `report`.
- Missing proof emits `prove_adapter_attachment`; stale/unknown capability emits `research_adapter_capability` (advisory until a verified report refresh exists). Follow the single `continuation.next_action_id`; alternatives are informational only.
- Force proves one adapter or stops; only prefer with `fallback_allowed` may fall back. Partial fails closed in V1.
- Route success is valid for one Bounded Browser Outcome: no adapter switching, no cold-browser fallback. Reroute when task bundle, target origin, selected adapter, proof, capability evidence, or preconditions change or expire.
- Contract + capability vocabulary owner: `skills/browser-use/scripts/command-contract.ts` and `browser-adapter-router-model.ts`.
- `puppeteer-core`: deterministic replay detail only; connect to verified `browserURL`.
- Explicit fresh/isolated browser request: say it is outside Warm Chrome proof, then use the requested path.
- Never use `chrome-isolated`, Playwright, Puppeteer auto-launch, Codex in-app browser, AppleScript, `osascript`, GUI scripting, or macOS `open` as fallback.

## Chrome DevTools MCP

Use after Warm Chrome Preflight and Browser Adapter Proof pass. Config repair details live in `mcporter-config.md`.

- Skill prose names the public tool: `mcporter`.
- Browser Adapter Proof owns command resolution and dependency recovery.
- Missing `mcporter`, package runner, or Chrome DevTools MCP is `adapter_dependency_missing`, not Browser Entry Handoff.
- Don't rewrite hot-path examples to a package runner; fix local command resolution instead.

```bash
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
mcporter call chrome-devtools.list_pages --args '{}' --output text
mcporter call chrome-devtools.select_page --args '{"pageId":9}' --output text
mcporter call chrome-devtools.navigate_page --args '{"url":"https://example.com"}' --output text
mcporter call chrome-devtools.take_snapshot --args '{}' --output text
mcporter call chrome-devtools.click --args '{"uid":"1_38","includeSnapshot":true}' --output text
mcporter call chrome-devtools.fill --args '{"uid":"1_13","value":"text","includeSnapshot":true}' --output text
mcporter call chrome-devtools.evaluate_script --args '{"function":"() => document.title"}' --output json
```

- Use `take_snapshot` before actions and current `uid` values only.
- Avoid `take_screenshot` unless visual layout matters.
- `list_pages` must show warm profile tabs. Blank/isolated browser means reattach failed.

If Browser Adapter Proof fails, follow `continuation.next_action_id`. Inspect or update adapter config outside the proof command, then rerun proof.

```bash
skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port "$PORT" --json
```

Do not run `mcporter daemon restart` inside proof. Do not switch to AppleScript, Playwright launch, Puppeteer launch, Codex in-app browser, or `chrome-isolated` as fallback.

## agent-browser

Future Browser Adapter Proof target. Current proof CLI does not accept this adapter.

- Always `--session <name>`; never default session.
- Always `--headed`.
- Always pass `--cdp "$PORT"` on every command.
- Session names come from `~/.config/side-quest/browser-automation/registry.yaml`.
- Never let `agent-browser` auto-launch; it may spawn Chrome for Testing.

```bash
agent-browser --session "$S" --headed --cdp "$PORT" get cdp-url
agent-browser --session "$S" --headed --cdp "$PORT" tab list
agent-browser --session "$S" --headed --cdp "$PORT" tab new <url>
agent-browser --session "$S" --headed --cdp "$PORT" snapshot -i
agent-browser --session "$S" --headed --cdp "$PORT" click @e3
agent-browser --session "$S" --headed --cdp "$PORT" get attr @e7 id
```

Refs (`@e1`...) are reassigned on every snapshot and go stale on any page change. Re-snapshot before the next ref interaction. For durable selectors, resolve a ref via `get attr @ref id`/`name`, or `eval` a CSS path.

`connect <port>` alone can report success while later commands use a sticky Chrome for Testing daemon. Proof-grade runs pass `--cdp "$PORT"` on every command and verify `get cdp-url` contains that port.

## puppeteer-core

Use for deterministic replay against a verified endpoint. Do not launch or repair Chrome here.

```ts
const browser = await puppeteer.connect({
	browserURL: `http://127.0.0.1:${port}`,
});
```

## Live UI Proof

Screenshot regressions, deployed dashboard checks, and rendered-browser bugs require Warm Chrome. `curl`, source inspection, Worker smoke tests, or isolated Playwright are supporting proof only.

## Secret Handling

Never print tokens/passwords from page DOM, network logs, or inputs. For token checks, return shape only: present/absent, length, status code, account/org name.
