# Handoff: Loop Engineering X Haul

**Date:** 2026-06-10
**From:** loop-engineering-x-hunter workflow (3 runs)
**Purpose:** Hand the mined dataset to a new agent to decide what to do with it.

---

## What Was Done

Three workflow runs mined X.com, Reddit, and the web for verified "loop engineering" /
agentic loop examples. The term was coined by @steipete on June 7 2026 (7.7M impressions).
Runs completed between 11:27 AM and 1:48 PM AEST on 2026-06-10.

### Run evolution
- **Run 1** — keyword query sweep only (8 parallel X searches). Stopped at 63 examples.
- **Run 2** — added seed reply/thread harvest + WOTS Reddit sweep. 65 net-new examples.
- **Run 3** — two-level community fan-out (L1 seeds → extract high-follower repliers → L2
  fan out to their timelines). WOTS working. 56 net-new examples. Zero query hunt passes
  needed — the community graph alone hit the target.

---

## The Haul

| Metric | Value |
|---|---|
| Total verified LOOP_EXAMPLEs | **184** |
| Unique sources | X search (107), X replies (30), WOTS Reddit (18), X timeline (17), X thread (12) |
| Loop types | generic (130), multi-agent (28), code-review (11), test-fix (9), content-gen (4), ui-screenshot (2) |
| MECHANISM signal | 107 examples (58%) |
| CYCLE signal | 86 examples (47%) |
| STOP signal | 44 examples (24%) |
| EVIDENCE signal | ~10 examples (5%) — the rarest, highest-value signal |
| 7-day window | 2026-06-03 to 2026-06-10 |

**Key gap:** EVIDENCE (actual code / screenshots / traces) is only 5% of examples.
Most of the haul is discourse and architectural description, not demonstrated implementations.

---

## Top 10 by Weighted Engagement

Weighted engagement = likes + bookmarks + floor(log10(followers+1)) × 10

| Rank | Author | Followers | W.Eng | Source | Quote |
|---|---|---|---|---|---|
| 1 | @akshay_pachaar | 276k | 1953 | x-timeline | "a PM reads a goal, breaks it into linked tasks, assigns each to the right agent" |
| 2 | @PawelHuryn | 74k | 1073 | x-search | "Six patterns for building dynamic workflows: classify-and-act, fan-out-and-synthesize..." |
| 3 | @NathanWilbanks_ | ? | 536 | x-search | "master loop harness: perpetual mission loops → goal loops → agent loops → workflow loops → tool loops" |
| 4 | @0xSero | 52k | 464 | x-timeline | "/goal in codex: bounded (stop on goal-reached) vs unbounded (perpetual automation)" |
| 5 | @dani_avila7 | 32k | 363 | wots-reddit | "send messages → model responds/calls tool → run tool → append result → repeat until stop_reason=end_turn" |
| 6 | @cellinlab | ? | 361 | x-search | "You no longer prompt the agent directly — you design a system that prompts the agent" |
| 7 | @PawelHuryn | 74k | 350 | x-timeline | "/document-app → /security-audit-static → /performance-audit-static → /derive-tests" |
| 8 | @0xSero | 52k | 335 | x-timeline | "1hr session, usable outputs, uses skills unprompted, debugs live in browser" (EVIDENCE) |
| 9 | @Av1dlive | 15k | 301 | wots-reddit | Boris Cherny: "I don't prompt Claude anymore... my job is to write loops." |
| 10 | @alphabatcher | 51k | 272 | x-timeline | Boris Cherny quote + 5-day Claude Code loop harness setup blueprint |

---

## Key Findings

- **Boris Cherny** (Claude Code creator) is the practitioner anchor: "My job is to write loops"
  surfaced via Reddit and X-timeline, not X-search. His 5-day harness setup blueprint
  (@alphabatcher) is the most actionable MECHANISM in the dataset.
- **@0xSero** has the only real EVIDENCE examples — a 1hr agent session with live debugging
  + screenshot, and the Codex `/goal` bounded/unbounded taxonomy.
- **@NathanWilbanks_** built a 5-level nested loop hierarchy (mission→goal→agent→workflow→tool)
  — the most architecturally complete description in the haul.
- **STOP signal is the design gap** — 76% of examples describe a loop without naming a
  termination condition. This is the most common loop design omission.
- Reddit (WOTS) surfaced different examples than X-search: longer-form, more implementation-
  oriented posts that X's 7-day API window missed via keyword search.

---

## What the Dataset Could Become

Options for a next agent to decide between:

1. **Prompt pack / few-shot examples** — extract the top 20 by signal quality (prioritise
   EVIDENCE + STOP + MECHANISM) and format as Claude system-prompt few-shot examples showing
   "what a real agentic loop looks like". Ready to inject into any agent harness.

2. **Synthesis essay** — write a structured "state of loop engineering, June 2026" document
   from the dataset. Cover: definition, taxonomy (bounded/unbounded, code-review/test-fix/
   multi-agent), common patterns, design gaps (STOP signal), key practitioners.

3. **Taxonomy + glossary** — extract and normalise the loop vocabulary: what terms are people
   using, how do they define CYCLE/STOP/MECHANISM/EVIDENCE in practice, what's the consensus
   definition vs the outliers.

4. **Gap analysis** — the 5% EVIDENCE rate is a gap. Run a targeted hunt for actual
   implementations: GitHub repos, blog posts with code, recorded demos. WOTS with
   `--include-web --deep` pointed at "agentic loop implementation code" or similar.

5. **Practitioner profiles** — the L2 fan-out identified 12 high-follower practitioners
   actively building loops. Profile each: what they're building, their loop patterns,
   their follower networks. Useful for knowing whose future posts to watch.

---

## Artifacts

| Artifact | Path |
|---|---|
| Full ledger (all 3 runs) | `docs/research/2026-06-10-loop-engineering-ledger.md` |
| Workflow script | `.claude/workflows/loop-engineering-x-hunter.js` |
| This handoff | `docs/research/2026-06-10-loop-engineering-handoff.md` |

All paths relative to `/Users/nathanvale/code/claude-code-config/`.

---

## Workflow Notes for Future Runs

- **Chunk raw X results to ≤15 tweets per verify agent** — critical for avoiding stalls.
  `chunkRawBatch()` function is in the workflow script.
- **WOTS works** — `--deep --sources=both` takes ~30s, well within agent timeout. Use
  `--refresh` to bypass cache.
- **7-day window is closing** — steipete's tweet was June 7. By June 14 it falls out of
  the X API search window. Any further X-based mining should run before then.
- **L2 fan-out seeds for next run** (already verified high-follower practitioners):
  @steipete, @akshay_pachaar, @0xSero, @PawelHuryn, @alphabatcher, @KingBootoshi,
  @Av1dlive, @humzaakhalid, @iuditg, @details_with_ai
