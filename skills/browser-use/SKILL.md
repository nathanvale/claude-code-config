---
name: browser-use
description: "Browser tasks through Warm Chrome; no Chrome for Testing."
role: tool-workflow
---

# Browser Use

One public workflow for browser tasks through warm Agent Chrome. Code owns
intent, authority, routing, runbooks, workflow recovery, and outcomes. The LLM
drives the selected adapter through its native tool surface after verified
attachment.

## Start

- Code-owned task: `browser-use guide` — copy-paste core loop (`task list` →
  `task run --intent <id>` → `run status`).
- Open-ended task: read `browser-connect dashboard --json`, select a
  connectable adapter from its evidence, then run
  `browser-connect connect <adapter> --json`. Save the verified handoff, run
  `browser-use targets list --mode handoff-bound --handoff <path> --json`, then
  dispatch supported work through `browser-use operate ... --handoff <path>`.
  Switching target or tab keeps that stable identity: reselect from
  `targets list` and pass the same handoff; never re-derive a target by index.
- Parallel agents: each run holds its own Target Lease and Browser Lane, so a
  concurrent agent never borrows another's target. Release the lease when the
  work finishes; a stale lease is a typed repair, not a reason to bypass
  custody.
- Open-ended login wall: stop. Confidential credential delivery is a separate
  future bridge and is not part of this milestone. Report the wall, the target,
  and what remains blocked, then hand back to the user. Do not attempt to fill
  credentials through an adapter, and do not treat a login wall as a product
  defect to escalate.
- Use Browser Use's custody-aware task, runbook, or operate command to
  perform and prove the requested outcome. An unsupported operation remains a
  typed product gap; direct adapter or raw CDP commands are outside Browser
  Use-mediated Target Lease and Browser Lane enforcement.
- Never copy adapter commands, response parsing, tab or page mechanics,
  navigation, actions, snapshots, screenshots, findings, or retries into this
  skill or Browser Use runtime. Owner: `docs/adr/0031-browser-use-delegates-browser-mechanics-to-adapters.md`.
- `browser-use --help` — all command families; every leaf has `--help`.
- Connection attaches automatically on `task run` / `runbook run`. Browser
  Connect owns open-ended attachment; Browser Use owns custody admission and
  operation outcomes. Envelopes and repair paths stay owned by
  `runtime/browser-connect`.
- For Runbook or Reviewed Action authoring and activation, read
  `../../docs/runbooks/authoring-runbooks.md` before mutation.
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
- Never route a browser login through the generic `one-password` skill, the
  generic `with-one-password-token` bin, or an ambient `op` session. None of
  them can confidentially deliver a credential into a browser; treating one as
  a login path leaks the value into this agent's context. Stop at the login
  wall instead.

## Owners

- Commands, flags, exit codes, diagnostic codes: `skills/browser-use/src/command-contract.ts`.
- Bundled guide content: `skills/browser-use/src/browser-use-guide.ts`.
- Connection, Verified Handoff Envelope, repair paths: `runtime/browser-connect`
  (`src/command-contract.ts`, `REPAIR.md`).
- Target Lease, Browser Lane, and custody admission:
  `skills/browser-use/src/browser-use-runtime.ts`.

## Next Safe Action

- Unsure where to start: run `browser-use guide`.
- Any failure envelope: read `error.code`, dispatch
  `continuation.next_action_id` verbatim, obey `continuation.constraints`.
  Exit 20 carries exactly one Repair Path anchor — follow it; never retry a
  convention port or fall back to a cold browser.
- Blocked or recovering: `browser-use guide --topic recovery`.
- Repeated terminal defect in `browser-use`, `browser-connect`, `warm-chrome`,
  a supported adapter CLI, or Browser Use Security; wrong or missing prose
  route; or prose-led outcome that does not satisfy the user's explicit request:
  hand off to
  `../browser-use-support-ticket/SKILL.md`; file one redacted, deduplicated
  public support ticket. Do not file expected login, user, or target-site
  blockers.
