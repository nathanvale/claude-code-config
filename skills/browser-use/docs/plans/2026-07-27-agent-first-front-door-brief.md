# Agent-First Front Door Design Brief

Date: 2026-07-27. Input: `/tmp/browser-use-agent-first-help-handoff.md` + pinned
`agent-browser` v0.31.2 help (scratch install, 374 lines) + current parser,
contract, and tests. Status: awaiting approval; no behavior changed.

## Objective

- `browser-use` is the only public front door for browser work.
- CLI help rises to the agent-browser standard: self-sufficient, so an agent
  reading only `--help` + `guide` can operate without external prose.
- `skills/browser-use/SKILL.md` thins to a router because the CLI carries the
  weight — help, guide, continuations are the mechanical drivers.
- `browser-connect` and `agent-browser` stay as internal owners/engines;
  Verified Handoff Envelope contract preserved.

## Owners (per handoff requirement)

| Role | Owner |
|---|---|
| Contract | `skills/browser-use/src/command-contract.ts` |
| Connection | `runtime/browser-connect` (envelope mint, repair paths) |
| CLI/orchestration | `skills/browser-use/src/browser-use.ts` driver + new orchestration seam |
| Help/discovery | `skills/browser-use/src/browser-use-parser.ts` (renderHelp) + new `guide` renderer |
| Smoke tests | new `skills/browser-use/src/browser-use-front-door.test.ts` |

## agent-browser v0.31.2 patterns adopted

1. One-line identity: `agent-browser - fast browser automation CLI for AI agents`.
2. `Start here (for AI agents):` block at top of root help.
3. **Version-matched bundled guidance**: `skills get core --full` ships workflow
   docs inside the CLI. This is the pattern that makes external skills thin.
4. Commands grouped by user intent, not by internal module.
5. Copy-paste examples of the core loop.
6. Explicit JSON, output-budget, session, safety guidance in help.

## Decisions proposed

### D1. No-arg behavior
Now: exit 2 + JSON usage error. Proposed: exit 0, print compact launcher
(identity line + Start here + top families + `--help` pointer). Matches
handoff smoke slice 1.

### D2. Root help shape (agent-first, intent-grouped)

```
browser-use - orchestrate browser tasks through one warm Chrome (for AI agents)

Usage: browser-use <family> <subcommand> [flags]

Start here (for AI agents):
  browser-use guide                Core workflow (version-matched, copy-paste)
  browser-use task list --json     Discover code-owned Task Intents
  browser-use runbook list --json  Discover service runbooks

Everyday work:
  task run --intent <intent>       Route, attach, execute, return next action
  run status|resume|cancel         Inspect or continue a shared run
  artifact ...                     Run artifact manifest

Recovery:
  repair ...                       Platform repair status + bounded execution
  auth ...                         Auth readiness + blocked-cause continuations

Advanced (platform internals):
  targets, operate, lanes, migration

Global flags: --json --plain --run-id --quiet --verbose --debug --version
```

Everyday path never names `browser-connect` or `agent-browser`. Advanced/leaf
help may still point at browser-connect for envelope-level work (BC).

### D3. `guide` family (the thin-skill mechanical driver)
New family: `guide` with `show` (default topic `core`; `--topic core|recovery|
auth|lanes`, `--full`). Renders version-matched workflow guidance from a
contract-adjacent source module — the content currently living in SKILL.md
Workflow/Page Actions/Next Safe Action sections. Mirrors agent-browser
`skills get core --full`. Help text stays under budget; guide carries depth.

### D4. Internal envelope mint for everyday path
`task run --intent <intent>` without `--handoff` mints the envelope internally
through the browser-connect library seam (same process, no shell-out), then
proceeds. `--handoff <path>` remains supported as the advanced/BC override.
`runbook run` gets the same treatment. Verified Handoff Envelope contract
unchanged — only who calls mint moves. Failure passthrough: browser-connect
failure envelope (exit 20, one Repair Path) surfaces verbatim.

### D5. Leaf usage names the executable
`Usage: task list ...` becomes `Usage: browser-use task list ...`. Owner:
`renderCommandUsage` call site (prefix at render, or facade change — decide at
implementation; prefer local prefix to avoid touching the shared facade).

### D6. Error identity
- Unknown family: `unknown command family: <token>. Expected: ...` (echo the
  invalid token, sanitized).
- Unknown leaf: `unknown subcommand for <family>: <token>. Expected: ...`.
- Invalid leaf + `--help` (e.g. `auth status --help`): exit 2 with unknown-
  subcommand error, never silent family help.

### D7. Smoke-test slice (from handoff, deterministic first)
New `browser-use-front-door.test.ts`:
1. No args → exit 0, contains identity line + `guide`.
2. Root help names safe first command (`browser-use guide`).
3. Everyday sections contain no `browser-connect`/`agent-browser` strings.
4. Every leaf usage line starts `Usage: browser-use `.
5. Unknown family/leaf errors echo the invalid token.
6. Invalid leaf `--help` exits 2.
7. `task list --json` parses.
8. agent-browser lane registered+implemented via `lanes list --json`.
9. Root help + no-arg output under fixed line budget (assert <= N lines).
10. PATH resolution check stays operator-verified via `setup status` (not a
    unit test); repo test asserts `package.json#bin` entries exist.
Existing split-front-door assertions in `browser-use-parser.test.ts` are
rewritten in the same change (deliberate contract decision, per handoff).

### D8. SKILL.md target shape (after CLI lands)
~25-30 lines: frontmatter, one-paragraph purpose, Invocation (installed bin +
repo-local), Start (`browser-use --help`, `browser-use guide`), Safety
invariants that must not be one level removed (Warm Chrome binary/profile/
loopback; no secret values in output; no mass-kill by port), owner-path list,
Next Safe Action (follow envelope `continuation.next_action_id`; exit 20 →
follow the single Repair Path anchor). Everything else moves:

| Current SKILL.md section | Destination |
|---|---|
| Engine Lanes | `guide --topic lanes` + `lanes list --json` |
| Workflow (envelope/state/select/operate) | `guide` core topic |
| Page Actions (lifecycle, ref binding, classification) | `guide` core topic (`--full`) |
| Next Safe Action recovery table | `guide --topic recovery` (already envelope-driven) |
| Verification commands | package.json scripts; drop from skill |
| Owner list | keep, compressed |

## Sequencing

1. Approve this brief (esp. D3, D4 — new family + orchestration seam).
2. Failing smoke tests (D7) — tdd.
3. Contract + parser + guide + orchestration seam (D1-D6).
4. Rewrite pinned parser tests; full verification suite.
5. Thin SKILL.md against the landed CLI (skill-author runbook; setup sync check).
6. fallow review; skill-feedback closeout.

## Cautions carried from handoff

- Preserve envelope ownership in browser-connect; no schema copies.
- No endpoint/cookie/token/secret values in help, guide, or smoke output.
- Untouched: unrelated dirty-worktree files.
- Warm Chrome + auth safety invariants unchanged.
