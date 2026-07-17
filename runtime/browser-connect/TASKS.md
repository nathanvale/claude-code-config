# Browser Connect Tasks

Hot-path project-manager dashboard.

Agent route: `AGENTS.md`. Plan lineage:
`docs/plans/2026-07-14-001-feat-browser-connect-plan.md`.
Archive: `TASKS.archive.md`.

## Governance

- Keep this file short enough to read before acting.
- Keep active tasks here.
- Move completed detail to `TASKS.archive.md` in the same pass that closes it.
- Write tasks as verifiable slices.
- Include the next command, source owner, or decision when known.

## Current Priority

Slice one is complete (U1–U9): the package proves Agent Chrome via
`@side-quest/warm-chrome` in-process, injects the verified endpoint, and
execs a Browser Adapter. `check`, `connect`, bare-no-arg `dashboard`, and
`run <adapter> -- <cmd>` are implemented and proven through the 19-station
Branch Station catalog (7 real process spawns, 12 skipped-with-rationale
needing a real Agent Chrome). Closed unit detail is in `TASKS.archive.md`.

Next work is slice two — Human Chrome via the UI-consent door
(chrome-devtools-mcp `--autoConnect`, Chrome 144+ consent flow), which
freshly verifies the territory ADR 0006 recorded as a dead end. See the plan
Scope Boundaries and `docs/decisions/2026-07-14-001-browser-connect-architecture-decision-log.md`.

Closed follow-up (2026-07-16): `rules/browser-access.md` retired via the
prompt-system workflow (issue #230) — full removal; invariants are
mechanically enforced here and re-homed in `skills/browser-use/SKILL.md`. The
coexistence window is closed.

## Roadmap

Roadmap home for the browser entry product line (KTD7). One line per pitch:
name | source pointer | trigger. Decision context:
`docs/decisions/2026-07-16-001-browser-use-migration-cleanup-decision-log.md`.

- UI-consent door (slice two) | browser-connect plan Scope Boundaries | already sequenced as the next slice.
- Extension door (slice three) | browser-connect plan | sequenced after slice two.
- Adapter fallback | ADR 0012 / KTD3 (retained R9 engine cluster) | registry reaches 3+ adapters, or first wrong-adapter incident.
- Per-agent target allocation | browser-use decision log | first concurrent-agent collision.
- 1Password-backed login | issue #145 cluster | first auth-blocked runbook.
- Operation floor | browser-domain-memory cluster (#136–#141) | two or more adapters each hold a green `browser-connect connect <adapter> --json` proof on the same host (evidence: `skills/browser-use/TEST_MATRIX.md` rows).

Roadmap footnotes (review-surfaced hardening ideas, not pitches): operate-time
endpoint re-verification (partially subsumed 2026-07-17: browser-use now
injects `endpoint.http` verbatim into every adapter spawn — see
`docs/decisions/2026-07-17-002-envelope-derived-transport-decision-log.md`;
re-PROVING the endpoint at operate time remains open); `playwright-cdp`
recovery dead-end enum entry; `target_selection_input_invalid` diagnostic
code split.

Next safe action:

```bash
bun --filter @side-quest/browser-connect typecheck
```
