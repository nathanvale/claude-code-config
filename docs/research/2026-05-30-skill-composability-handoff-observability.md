---
title: "Skill composability / handoff / observability — community research + reality check"
type: research
status: active
updated: 2026-05-30
summary: "Newsroom sweep on lean composable skills, description routing, capture->ledger loop. Verdict: the pattern is where the field is heading, BUT skills do NOT reliably auto-trigger each other from descriptions (~0-50%). Realistic version = explicit Skill() handoff from a lean driver + a Stop hook for end-of-run capture. The capture->ledger compounding loop is real and named."
source: newsroom-investigate (@side-quest/word-on-the-street CLI)
source_system: repo
related:
  - docs/brainstorms/2026-05-30-skill-composability-handoff-principle.md
  - skills/browser-use/docs/brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md
  - context/skill-design-philosophy.md
---

# Skill composability / handoff / observability — research + reality check

Provenance: `newsroom-investigate` 2026-05-30, three beat-reporters (composable agent handoff ·
skill auto-discovery / description routing · agent run observability + capture ledger) + fact-checker.
Tests whether the browse/domain-checker/capture-run composability pattern is realistic.

## Bottom line

**Your instinct is where the field is heading — but ONE assumption needs correcting before building.**
Lean composable skills + a capture->ledger loop is mainstream-emerging, not fringe. The wishful part
is "skills auto-trigger each other from their descriptions" — that is ~0-50% reliable today. Swap it
for **explicit `Skill()` handoff from a lean driver + a Stop hook for end-of-run capture**, and the
whole pattern becomes the robust, community-validated version of itself.

## The critical correction (fact-checked)

The seed/principle assumed: *"description IS the wiring; skills listen, auto-fire, and hand back."*
The research contradicts the auto-fire-between-skills half:

- **No documented case of one Claude Code skill auto-triggering another via description matching.**
  (VERIFIED by absence across all sources.) Every real multi-skill chain uses **explicit
  `Skill(name)` orchestration**, not emergent peer-to-peer description routing. (MindStudio's
  autonomous pipeline = explicit `Skill()` calls in sequence.)
- **Single-skill auto-activation is unreliable at baseline:** ~20% (Haiku) / ~50-55% (Sonnet) from
  description alone. Reaches **84-100% only with a forced-eval / Stop hook** — NOT from description
  wording alone (this corrects a reporter overstatement that "good descriptions reach 72-90%";
  Spence's eval data shows optimized descriptions without a hook still sit at ~50%). (CONTRADICTED →
  corrected.)
- **Complex multi-skill routing drops to ~0% without a hook.** (VERIFIED.) Open issue #20986: Claude
  ignored a skill on an *exact* description match; closed as duplicate, no fix. Both fail-to-fire
  and mis-fire are real.
- **~15,000-char metadata budget** for all skill descriptions; overflow silently drops least-used
  skills. (VERIFIED — official docs, `SLASH_COMMAND_TOOL_CHAR_BUDGET`.) Practitioner cap ~8-12
  skills. Validates the "not too many skills" instinct with a mechanical reason.

### What this changes in the design

Keep everything lean/composable/one-ledger. Change only the **wiring**:

- **browse stays the lean driver and hands off EXPLICITLY:** `Skill(domain-checker)` when it hits a
  domain; capture-run fires on a **Stop hook** at end-of-run (a hook is the reliable mechanism for
  "a run just finished" — a description is not).
- Skills are still small, single-purpose, discoverable. But the handoff is a deliberate call /
  hook, NOT hope that peer descriptions route (~0-50%).
- "Listeners hand back to the driver, never to each other" still holds — and is now load-bearing,
  because peer-to-peer auto-routing doesn't work anyway.

## What IS strongly validated

- **Lean composable skills — the field is converging here.** OpenAI Agents SDK makes *handoffs* its
  core primitive; Anthropic Skills+MCP called "the blueprint for the next era"; Pydantic AI shipped
  "Composable Capabilities"; CrewAI added agent skills + A2A. Practitioners actively build
  `/agent-handoff`, "session handoff" skills (@LearnWithBrij, 2,197 likes).
- **capture-run -> ledger -> compounding loop — real and named.** MindStudio documents the exact
  pattern: "every session reads from the corpus on the way in and writes back on the way out" via a
  `learnings.md` (VERIFIED). MemRL (arXiv 2601.03192, real paper + code) = the research version:
  agents self-improving from episodic run memory.
- **Skill = description-as-routing-signal is real** (VERIFIED, official docs): ~100 tokens/skill
  scanned at startup; body loads on demand. The model *does* route off the description — it's just
  unreliable without a hook backstop.

## What the community agrees vs debates

- **Agreed:** lean, single-purpose, selectively-loaded skills are the right shape. Microsoft's
  widely-cited heuristic: "start centralized, decentralize only when you hit concrete bottlenecks."
- **Debated:** centralized orchestrator vs decentralized peer handoff — no consensus; tradeoff is
  explicitly resilience vs debuggability. Nobody declares emergent handoff superior.
- **Honest practitioner note (@jsyqrt):** "composability unlocked behavior we didn't anticipate" —
  emergent chaining produces surprises, not just wins. Reason to keep handoff explicit.
- **Observability blind spot:** "agent observability is still just LLM tracing"; dominant production
  complaint is silent failures / "flying blind." Reinforces: capture-run must be a reliable hook,
  and healed/uncertain steps must surface, not silently pass.

## Fact-check ledger (6 claims)

- VERIFIED — skills load on ~100-token description; description is the routing signal (official docs)
- **CONTRADICTED/corrected** — trigger reliability: ~20% Haiku / ~50-55% Sonnet baseline; 84-100%
  only WITH a hook; multi-skill ~0% without one. ("good descriptions reach 72-90%" was overstated.)
- VERIFIED — documented fail-to-fire on exact match (#20986) + mis-fire both real
- VERIFIED — ~15,000-char metadata budget; overflow drops least-used skills (cap ~8-12)
- VERIFIED — NO documented skill->skill auto-handoff via descriptions; chaining is always explicit `Skill()`
- VERIFIED — compounding read-in/write-out ledger loop + self-improving-from-runs (MemRL) real

## Reference points to study

- OpenAI Agents SDK handoffs (handoff as a first-class primitive).
- MindStudio compounding-knowledge-loop (`learnings.md` read-in/write-out) — closest to capture-run.
- MemRL (arXiv 2601.03192) — episodic-memory self-improvement, the research ceiling.
- Stop hook / forced-eval hook pattern (Scott Spence evals) — the reliable trigger mechanism.

## Stats

Reddit 26 posts · X 34 posts · YouTube 14 videos (~1.4M views) · ~18 web/arXiv pages · 6 fact-checked.
