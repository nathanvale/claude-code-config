# Provenance: browser-domain-memory

- Origin: first-party skill in this repo.
- Active plan: `docs/plans/2026-05-31-001-feat-browser-domain-memory-plan.md`.
- Superseded plan: `docs/plans/2026-05-30-001-feat-browser-domain-memory-plan.md`.
- Requirements source: `docs/brainstorms/2026-05-30-browse-play-record-replay-requirements.md`.
- Glossary owner: `CONTEXT.md`.

## Status

- Canonical directory exists.
- Prerequisite gate landed: `skills/browser-domain-memory/scripts/` (prototype evidence, root replay deps, script-local facade readiness). Prerequisites plan: `docs/plans/2026-06-01-001-feat-browser-domain-memory-prerequisites-plan.md` (issue #134).
- Runtime implementation not landed: no storage, replay, auth, gates, or promotion routes yet.
- Restored prototype evidence is now tracked under `prototypes/browser-use-uplift/` and `prototypes/build-scratch-handoff/`.
- Stub prevents agents from assuming the old prose-only v1 exists.

## Planned Implements

- Auth Pointer.
- Browser Runbook.
- Recorder JSON.
- Browser Gotcha.
- Scratch Evidence.
- Run Outcome.
- Browser capture.
- Prose mode.
- Runbook mode.
- Deterministic mode.

## Notes

- Run the prerequisite gate before runtime work; it gates U0/U1/U1a on present evidence and packages.
- Start implementation from active plan U0/U1/U9 unless Nathan says otherwise.
- `browser-use` owns Warm Chrome readiness, repair, launch, and adapter routing.
- `browser-domain-memory` owns durable browser knowledge after the runtime lands.
