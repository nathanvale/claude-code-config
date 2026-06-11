---
status: accepted
---

# skill-feedback fires capture on harness hooks, not agent recall

skill-feedback's v0 capture trigger is the harness end-of-run hook on both supported harnesses — the Claude Code Stop hook (which already surfaces as a `claude_code.hook` OTel span) and Codex `notify=agent-turn-complete`. We rejected the prior plan's "driver agent remembers to call `record`" trigger, and pulled the Claude Stop hook out of "deferred to future" into v0 scope.

## Considered Options

- **Agent recall (rejected).** The top-level driver calls `skill-feedback record` when it notices a skill closed. Fact-checked reliability: ~20% (Haiku) / ~50% (Sonnet) for single-skill recall, ~0% for multi-skill routing (`docs/research/2026-05-30-skill-composability-handoff-observability.md`, bug #20986). Piloting a *capture* loop on a coin-flip trigger means you cannot distinguish "skill was smooth" from "capture was missed" — it poisons the pilot's own success criterion.
- **Harness hooks, both harnesses (accepted).** Stop hook / `notify` deliver 84–100% capture (Scott Spence eval data). Both surfaces already ship today — confirmed against `code.claude.com/docs` (the `claude_code.hook` span exists in the live OTel tree) and the Codex `exec --json` / `notify` surface. The trigger wires up existing harness capability; it invents nothing.
- **Codex-only v0 (rejected for now).** Reliable via `notify` today, but tests only one harness and leaves the Claude path unproven.

## Consequences

- v0 scope grows by the Claude Stop-hook wiring; this was previously parked as future work. The trade is reliable pilot data for slightly more v0 build.
- Agent recall survives only as a fallback when a hook is unavailable, never the primary path.
- The `claude_code.hook` span means the trigger and the `gen_ai.evaluation.result` emission are natively composable in one OTel tree.
- The plan (`docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`) Scope Boundaries entry "Stop hook (Claude) end-of-run capture — deferred" is superseded by this ADR and must move into v0 scope.
