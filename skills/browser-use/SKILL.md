---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
role: tool-workflow
---

# Browser Use

One public front door: the `browser-use` CLI orchestrates browser tasks through
warm Agent Chrome — task routing, automatic connection attach, runs, runbooks,
recovery. Its help and bundled guide are version-matched and self-sufficient:
read them at runtime instead of prose here.

## Start

- `browser-use guide` — copy-paste core loop (`task list` → `task run --intent <id>` → `run status`).
- `browser-use --help` — all command families; every leaf has `--help`.
- Connection attaches automatically on `task run` / `runbook run`. Envelopes and
  repair paths stay owned by `runtime/browser-connect`; driving its CLI directly
  is advanced, never the everyday path.
- For browser-use project work, read `references/coding-task-tracker.md` before
  choosing or updating a tracker task.

## Invocation

- From any CWD: `browser-use` resolves on PATH (`setup sync` installs and
  repairs the bin; `setup status` verifies).
- Repo-local: `bun run browser-use <command>` from `skills/browser-use`.

## Safety

- Warm Chrome only: real Google Chrome, dedicated persistent profile, loopback
  CDP. Never Chrome for Testing, throwaway or everyday-default profiles,
  isolated Playwright/Puppeteer launch, AppleScript/`open`, or cold-browser
  fallback. Invariant detail: `references/warm-chrome.md`.
- No convention endpoints: never hardcode `http://127.0.0.1:9222`; verified
  endpoints travel inside envelopes.
- Never mass-kill by port; listener remediation is operator-owned
  (`runtime/browser-connect/REPAIR.md#v1-inspect_listener`).
- Never print tokens, cookies, passwords, or auth-bearing URLs; report secret
  checks by shape only (present/absent, length, status code).

## Owners

- Commands, flags, exit codes, diagnostic codes: `skills/browser-use/src/command-contract.ts`.
- Bundled guide content: `skills/browser-use/src/browser-use-guide.ts`.
- Connection, Verified Handoff Envelope, repair paths: `runtime/browser-connect`
  (`src/command-contract.ts`, `REPAIR.md`).

## Next Safe Action

- Unsure where to start: run `browser-use guide`.
- Any failure envelope: read `error.code`, dispatch
  `continuation.next_action_id` verbatim, obey `continuation.constraints`.
  Exit 20 carries exactly one Repair Path anchor — follow it; never retry a
  convention port or fall back to a cold browser.
- Blocked or recovering: `browser-use guide --topic recovery`.
