# PROTOTYPE — REAL measured cold-vs-warm (honesty correction)

**Question:** Is the warm-replay speedup real when you put a real clock on a real
page — and where does the speedup actually come from?

## Result (three measurements, one honest conclusion)

| What was measured | Ratio | Meaning |
|---|---|---|
| Earlier *simulated* cost model (`../metrics-wallclock/`) | 9× | Assumed discovery was expensive — **overstated** |
| Real: locate login fields, page-load dominated (`real-cold-vs-warm.ts`) | **1.0×** (8ms) | On a simple page, browser work is trivial vs page load |
| Real: agent explore-loop, snapshot+enumerate ×3 (`explore-loop.ts`) | **5.4×** | The *browser* part of cold exploration |

## The honest conclusion

The speedup is **NOT** about `querySelector` being slow — it isn't (~8ms). Two
real costs make cold runs slow, and replay skips both:

1. **The browser explore-loop** — a live agent takes a full page snapshot +
   enumerates interactive elements before each step, and re-snapshots after each
   action. Measured ~5.4× heavier than direct selector recall (browser work only).
2. **LLM think time (the dominant cost, NOT measured here)** — a real agent does
   snapshot → send to model → reason → act → re-snapshot → reason again, several
   *seconds* of model latency per step. Replay does **zero** model rounds. This is
   where the real-world minutes-vs-seconds gap lives; measuring it would burn live
   LLM calls, so it's left as a reasoned claim, not a number.

**So:** the earlier 9× simulation was directionally right (replay >> explore) but
for the WRONG reason — it blamed selector-finding cost. The real win is
**eliminating the agent's look-and-think loop.** On a trivial page that's small
(1×); on a real multi-step portal flow with per-step re-snapshots + model latency,
it's large.

## Run

```
# needs warm Chrome on $PORT (default 9444) + puppeteer-core/@puppeteer/replay
bun prototypes/browser-use-uplift/metrics-real/real-cold-vs-warm.ts
bun prototypes/browser-use-uplift/metrics-real/explore-loop.ts
```

## Findings for browser-domain-memory

- **Don't sell the speedup as raw selector speed.** Sell it as "replay skips the
  agent's explore-and-reason loop." That's the true mechanism and it's honest.
- The metrics-wallclock 9× figure should be relabelled as an illustrative model,
  not a measurement — or re-derived against per-step LLM-round counts.
- The biggest real lever is **reasoning rounds eliminated**, so telemetry should
  track model-rounds/snapshots per run, not just wall-clock — that's the metric
  that actually moves.

## Throwaway
Supersedes the metrics-wallclock headline with measured reality. Keep the
"skip the think-loop" framing for the brainstorm/value story.
