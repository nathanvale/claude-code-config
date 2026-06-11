---
status: accepted
date: 2026-06-11
amended: 2026-06-11
---

# skill-feedback fires capture on harness hooks, not agent recall

skill-feedback's v0 capture trigger is the harness end-of-run hook, not driver-agent recall. The live v0 detector is the Claude Code Stop hook. Codex `notify=agent-turn-complete` stays installed as a coexistence dispatcher, but it does not detect skill closes because the notify payload carries no skill identity.

The Codex JSON adapter remains a seam proof for captured `codex exec --json` streams. Wiring that adapter into live Codex capture needs an item-stream reader or equivalent identity source that can be reached from the notify environment.

## Considered Options

- **Agent recall (rejected).** The top-level driver calls `skill-feedback record` when it notices a skill closed. Fact-checked reliability: ~20% (Haiku) / ~50% (Sonnet) for single-skill recall, ~0% for multi-skill routing (`docs/research/2026-05-30-skill-composability-handoff-observability.md`, bug #20986). Piloting a *capture* loop on a coin-flip trigger means you cannot distinguish "skill was smooth" from "capture was missed" — it poisons the pilot's own success criterion.
- **Harness hooks with both live detectors (superseded).** Stop hook / `notify` looked like a two-harness trigger. Review found the Codex notify payload has `type`, `turn-id`, `cwd`, `last-assistant-message`, and `input-messages`, but no skill identity and no `codex exec --json` item stream.
- **Claude live, Codex dispatch-only (accepted amendment).** Keep Claude Stop as the v0 live detector. Keep Codex notify as a forwarding dispatcher and fixture-test the Codex JSON adapter separately. Defer live Codex capture until an item-stream reader or equivalent skill identity source exists.
- **Codex-only v0 (rejected).** `notify` fires reliably, but it cannot identify the finished skill by itself. A Codex-only v0 would still need a separate item-stream reader and would leave the Claude path unproven.

## Consequences

- v0 scope grows by the Claude Stop-hook wiring; this was previously parked as future work. The trade is reliable pilot data for slightly more v0 build.
- Agent recall survives only as a fallback when a hook is unavailable, never the primary path.
- The `claude_code.hook` span means the trigger and the `gen_ai.evaluation.result` emission are natively composable in one OTel tree.
- Codex notify coexistence is still valuable, but it is not evidence that live Codex skill capture works.
- Tests must use the real bare notify shape for dispatcher behavior. Skill-bearing Codex payloads are future fixtures unless an item-stream reader lands.
- The plan (`docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`) Scope Boundaries entry "Stop hook (Claude) end-of-run capture — deferred" is superseded by this ADR and must move into v0 scope.
