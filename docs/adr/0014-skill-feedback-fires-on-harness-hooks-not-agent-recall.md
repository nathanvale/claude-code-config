---
status: accepted
date: 2026-06-11
amended: 2026-06-12
---

# skill-feedback fires capture on harness hooks, not agent recall

skill-feedback's capture trigger is the harness end-of-run hook, not driver-agent recall. The live v0 detector is the Claude Code Stop hook. Codex Stop is now the Codex capture point; Codex close detection stays blocked until a Trusted skill identity source is proven.

Codex `notify=agent-turn-complete` remains legacy forwarding evidence. It cannot satisfy Codex capture readiness because notify evidence does not prove Trusted skill identity and is not the lifecycle Stop capture path.

## Considered Options

- **Agent recall (rejected).** The top-level driver calls `skill-feedback record` when it notices a skill closed. Fact-checked reliability: ~20% (Haiku) / ~50% (Sonnet) for single-skill recall, ~0% for multi-skill routing (`docs/research/2026-05-30-skill-composability-handoff-observability.md`, bug #20986). Piloting a *capture* loop on a coin-flip trigger means you cannot distinguish "skill was smooth" from "capture was missed" — it poisons the pilot's own success criterion.
- **Harness hooks with both live detectors (superseded).** Stop hook / `notify` looked like a two-harness trigger. Review found the Codex notify payload has `type`, `turn-id`, `cwd`, `last-assistant-message`, and `input-messages`, but no skill identity and no `codex exec --json` item stream.
- **Claude live, Codex dispatch-only (superseded amendment).** Keep Claude Stop as the v0 live detector. Keep Codex notify as a forwarding dispatcher and fixture-test the Codex JSON adapter separately. Defer live Codex capture until an item-stream reader or equivalent skill identity source exists.
- **Claude Stop plus Codex Stop with identity gate (accepted amendment).** Current Codex lifecycle hooks include Stop. Treat Codex Stop as the Codex capture point, but keep Codex close detection and ledger readiness blocked until a Trusted skill identity source is proven.
- **Codex-only v0 (rejected).** `notify` fires reliably, but it cannot identify the finished skill by itself. A Codex-only v0 would still need a separate item-stream reader and would leave the Claude path unproven.

## Consequences

- v0 scope grows by the Claude Stop-hook wiring; this was previously parked as future work. The trade is reliable pilot data for slightly more v0 build.
- Agent recall survives only as a fallback when a hook is unavailable, never the primary path.
- The `claude_code.hook` span means the trigger and the `gen_ai.evaluation.result` emission are natively composable in one OTel tree.
- Codex Stop is the Codex capture point for v2 readiness.
- Codex notify coexistence is still valuable, but it is legacy forwarding evidence and cannot open the Codex capture readiness gate.
- Review needs capture provenance, such as `capture_runtime`, so Codex Stop and Codex notify evidence cannot collapse into one hook-capture lane.
- Trusted skill identity remains the gate. If no engine-owned identity source is reachable from Codex Stop or adjacent engine evidence, Codex-led ledger implementation stays blocked.
- Tests must use the real bare notify shape for dispatcher behavior. Skill-bearing Codex payloads remain fixtures unless they come from a trusted Codex Stop identity source.
- The plan (`skills/skill-feedback/docs/plans/2026-06-11-002-feat-skill-feedback-loop-v0-pilot-plan.md`) Scope Boundaries entry "Stop hook (Claude) end-of-run capture — deferred" is superseded by this ADR and must move into v0 scope.
