# Handoff: Loop Engineering Mining Session Retrospective

**Date:** 2026-06-10
**For:** A retrospective agent to analyse what went well, what failed, and what to carry forward.
**Session window:** ~11:27 AM – 2:05 PM AEST (approx 2.5 hours)

---

## What This Session Did

Designed and ran a multi-pass X/Reddit mining workflow to harvest verified "loop engineering"
examples — a term coined by @steipete on June 7 2026 that went viral (7.7M impressions).

The goal: build a ledger of real agentic loop examples from the community, with enough
signal quality to use as prompt-pack / few-shot training material.

---

## The Three Runs

### Run 1 — Keyword query sweep
- **Design:** 8 parallel X API keyword searches → 1 monolithic verify agent
- **Result:** 63 examples
- **Failure:** The single verify agent stalled on retry 5 every time (too much context — 240 tweets in one shot)
- **Fix applied:** Fan out 1 verify agent per query batch (~30 tweets each)

### Run 2 — Seed reply harvest + WOTS
- **Design:** replies/threads on 4 seed tweets + WOTS Reddit/web sweep → parallel verify per batch
- **Result:** 65 net-new examples
- **Failures:**
  - WOTS agents stalled (2 failures) — agents were doing too much (run CLI + format results)
  - Verify agents on large reply batches still stalled occasionally
- **Fix applied for Run 3:**
  - WOTS agents: just run the command, return raw stdout — no processing inside agent
  - Reply batches: chunk raw X results to ≤15 tweets per verify agent (`chunkRawBatch()`)

### Run 3 — Two-level community fan-out
- **Design:**
  - L1: fetch replies/threads on 4 seeds + 3 WOTS queries in parallel
  - L1 Verify: classify + extract high-follower repliers (>2k followers) as L2 seeds
  - L2: fan out to 12 high-follower authors — their recent loop tweets + their replies to steipete
  - L2 Verify: classify L2 candidates
  - Hunt: fallback query sweep (not needed — L1+L2 hit target)
- **Result:** 56 net-new examples, 0 hunt passes needed
- **Key insight:** The community graph alone was sufficient. No query sweep required.
- **L2 seeds discovered:** @grok (8.8M), @steipete (539k), @AgentGuard_AI (325k),
  @akshay_pachaar (276k), @nrqa__ (77k), @PawelHuryn (74k), @details_with_ai (74k),
  @iuditg (60k), @humzaakhalid (56k), @0xSero (52k), @alphabatcher (51k), @KingBootoshi (49k)

---

## Combined Haul

- **184 verified LOOP_EXAMPLEs** across 3 runs
- **Sources:** X search (107), X replies (30), WOTS Reddit (18), X timeline (17), X thread (12)
- **Zero duplicates** — PRIOR_IDS set carried forward between runs

---

## What Worked Well

1. **Fan-out verify (1 agent per batch)** — the single biggest fix. Eliminated all stalls.
   Small context = fast + reliable. Should be the default for any classify-at-scale workflow.

2. **chunkRawBatch()** — splitting raw X reply JSON into ≤15 tweet chunks before dispatch
   solved the L1 verify stalls that plagued runs 1 and 2. Simple function, high impact.

3. **WOTS thin agent pattern** — "just run the command, return raw stdout" — no summarising,
   no formatting inside the agent. 29s wall clock, zero stalls. WOTS has its own retry/
   rate-limit resilience; agents don't need to babysit it.

4. **Two-level fan-out** — the highest-signal examples came from practitioners' *timelines*,
   not from keyword searches. @akshay_pachaar's PM→agent kanban loop (w=1953) and @0xSero's
   Codex /goal taxonomy would never have surfaced via "loop engineering" keyword search.

5. **Follower-weighted engagement scoring** — `raw_engagement + floor(log10(followers+1)) * 10`
   correctly bubbled up practitioner content over low-follower discourse amplifiers.

6. **Resume from run ID** — when runs stalled or were stopped for fixes, resuming with
   `resumeFromRunId` replayed completed agents from cache instantly. Saved significant time
   on run 3 (L1 harvest ~8 agents replayed in <1s).

7. **PRIOR_IDS dedup set** — carrying all 128 known IDs from runs 1+2 into run 3 meant
   zero re-harvesting. Clean separation between runs without needing a persistent store.

---

## What Failed / Friction Points

1. **Monolithic verify agent** — the original design (1 agent for all results) failed on
   every run before the fan-out fix. Root cause: X reply batches for high-engagement seed
   tweets can be 100 tweets × ~500 tokens each = 50k tokens in one agent context.

2. **WOTS stalls in run 2** — agents asked to "run WOTS and format/classify the output"
   timed out at the 3-minute stall detector. Fix: thin agent = raw stdout only.

3. **Verify source type confusion** — the VERIFY_PROMPT function took a `source` string
   but the index-based heuristic for assigning "x-replies" vs "x-thread" was fragile after
   chunking multiplied the batch count. A cleaner design would tag each batch with its
   source before passing to verify.

4. **X API rate limits on `from:<user>` queries** — the L2 "from:user to:steipete" queries
   hit rate limits more than keyword queries. Several L2 agents retried 3-4 times. Not a
   blocker but added latency.

5. **96 agents in run 3** — the two-level fan-out with chunking spawned many more agents
   than expected (~20 L1 harvest + ~30 L1 verify chunks + ~24 L2 harvest + ~24 L2 verify).
   Still within the 1000-agent cap but worth budgeting for in future designs.

6. **EVIDENCE signal gap** — only ~5% of examples have real code/screenshots/traces.
   The workflow design (keyword search + reply harvest) is optimised for discourse, not
   implementations. A separate implementation-hunting run (GitHub search, blog scrape) is
   needed to close this gap.

---

## Design Patterns to Carry Forward

### The Fan-Out Classify pattern
```
raw_batches = fetch_all_sources()
chunked = raw_batches.flatMap(b => chunkRawBatch(b, 15))
results = parallel(chunked.map(chunk => verify_agent(chunk)))
```
One classify agent per ≤15-item chunk. Never one agent for all results.

### The Thin WOTS agent
```
agent("Run: bunx wots <query> --emit=json --quiet --refresh\nReturn raw stdout only.")
```
No processing inside the agent. WOTS handles its own retries.

### The Two-Level Fan-Out
```
L1: fetch seed replies + thread
L1 verify: classify + extract high_follower_authors
L2: parallel(seeds.map(u => search `from:${u} <topic>`))
L2 verify: classify
```
The community graph is higher signal than keyword search for emerging topics.

### PRIOR_IDS dedup set
Bake all known IDs into the script as a constant before each new run.
Never rely on runtime state to track cross-run dedup.

### Resume-on-fix workflow
Stop → edit script → `resumeFromRunId` → only new/changed agents re-run.
The journal is a persistent cache; completed work is never thrown away.

---

## Open Questions for the Retro

1. **Why did the WOTS `--deep` runs return fewer Reddit items than expected?**
   The 7-day window + "loop engineering" as a brand-new term may mean Reddit hasn't
   indexed much yet. Worth re-running with `--days=30` once the discourse matures.

2. **Could the L2 fan-out go deeper (L3)?** The 12 L2 seeds themselves have reply threads.
   A third hop would surface even more practitioners — but with diminishing returns and
   exponentially more agents. Cap at 2 levels for now.

3. **Is the EVIDENCE gap solvable on X?** The format (280 chars) doesn't lend itself to
   code. A GitHub/blog scrape workflow is the right tool for EVIDENCE, not X search.

4. **What's the right verify chunk size?** 15 tweets worked. 30 didn't. Is 20 reliable?
   Needs empirical testing against stall rate.

---

## Key Files

All paths relative to `/Users/nathanvale/code/claude-code-config/`:

| File | Purpose |
|---|---|
| `.claude/workflows/loop-engineering-x-hunter.js` | The final workflow script (v3) |
| `docs/research/2026-06-10-loop-engineering-ledger.md` | Full 3-run ledger (539 lines) |
| `docs/research/2026-06-10-loop-engineering-handoff.md` | Dataset handoff for next agent |
| `docs/research/2026-06-10-loop-engineering-retro-handoff.md` | This file |
