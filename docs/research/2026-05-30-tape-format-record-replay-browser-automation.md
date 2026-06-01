---
title: "Tape format for record-replay browser automation — research"
type: research
status: active
updated: 2026-05-30
summary: "Newsroom sweep on the browse/play tape-format question: plain JSON steps vs LLM replay vs self-healing hybrid. Resolves to: deterministic JSON tape spine + variable-slot layer + tiered self-healing with a human-review gate on any heal. Silent substitution is the risk to design against."
source: newsroom-investigate (@side-quest/word-on-the-street CLI)
source_system: repo
related:
  - docs/brainstorms/2026-05-30-browse-play-record-replay-skills-seed.md
---

# Tape format for record-replay browser automation — research

Provenance: `newsroom-investigate` run 2026-05-30, three beat-reporters (Chrome Recorder JSON step
schema · self-healing selectors · deterministic-vs-LLM replay) + fact-checker. Resolves the open
tape-format question in the browse/play seed (see `related`).

## Bottom line (decision-grade)

**Hybrid, with a deterministic JSON tape as the spine.** Not pure-deterministic (too brittle), not
LLM-replay (non-deterministic + costly). Highest-engagement practitioner heuristic (@jonallie, 1127
likes): *"don't use an LLM for what a deterministic program can do — have an agent write a
deterministic program, then run that."* That is exactly browse (LLM writes tape once) → play
(deterministic replay).

## The three options, judged

### 1. Plain JSON step list — viable spine, two confirmed holes (VERIFIED)
Chrome Recorder / `@puppeteer/replay` schema: `navigate / click / change / waitForElement` steps,
each with a **`selectors` array of fallback strategies in priority order** (aria → data-testid →
css → id → xpath → pierce → text). That fallback array is built-in, free resilience. Gaps:
- **No variable/template syntax** — values are literal strings; parameterizing dates/hours needs a
  pre-processing layer (the exact timesheet pain). Workflow Use's "variable slots" is the answer.
- Hover not auto-captured; fixed per-step timeout (5000ms default); Puppeteer-bound (Playwright has
  no native Recorder-JSON replay).
- Runner (`@puppeteer/replay`) is a thin JSON interpreter — "one Node dep," not a framework.

### 2. Pure LLM re-driving — wrong for recurring tasks (VERIFIED)
Peer-reviewed: **even at temperature=0, LLM agents vary ~15% across runs** (arXiv 2408.04667 —
floating-point / GPU non-determinism; best-to-worst gaps up to 70%). "True deterministic replay of
an LLM-in-the-loop" is impossible — the hard argument for compiling to a script. Cost compounds
(~$0.15-0.30 / 10-step task; ~$2 / complex form). Fine for one-offs, wrong for weekly automations.

### 3. Self-healing hybrid — the target, with a sharp warning
Mature pattern = 3-tier locator cascade: (1) stored selector, ms/free → (2) deterministic
attribute / AX-tree re-scoring, sub-second/free → (3) LLM re-derivation only on tier-2 failure, then
re-cache. Open blueprint exists: arXiv 2603.20358 "zero-cost DOM-tree" — 10-tier AX-tree priority,
re-heal on failure, no LLM at runtime.

**Dominant practitioner warning — design around it: SILENT SUBSTITUTION.** Healing finds a
"close-enough" element and continues → run stays green while clicking the *wrong* control
(documented: a payment-validation regression shipped this way). So: **a healed step must be flagged
for human review, never silently accepted.** This is the ask-when-unsure principle applied to replay.

## Recommended browse/play design (what the research points at)

| Layer | Decision |
|---|---|
| Tape format | Deterministic JSON step list (Recorder/puppeteer-replay shape). Readable, editable, thin runner. |
| Selectors | Capture the fallback array (AX/aria first — most drift-resistant), not a single CSS path. |
| Parameters | Add a variable-slot layer the base schema lacks (dates/hours as `{{vars}}`, resolved at replay). |
| Replay | Deterministic fast-path, zero LLM on the happy path (cost + determinism win). |
| On failure | Tier-2 deterministic re-heal (AX re-resolve) → tier-3 LLM only if that fails → flag the healed step + ask the human. Never silent-substitute. |
| Auth | Stays the closed-box op-inject runbook (separate concern). |

## Fact-check ledger (5 claims)

- VERIFIED — Recorder JSON has no variable syntax; `selectors` is a prioritized fallback array
- VERIFIED — temp=0 LLMs vary ~15% across runs; true LLM-loop replay impossible (arXiv 2408.04667)
- **CONTRADICTED** — Stagehand "10-100x faster / zero tokens": real figure ~80% speedup; browser
  execution time still costs. Mechanism real, magnitudes are vendor marketing.
- UNVERIFIED — "60% abandon self-healing in 3mo / 23% more false-positives": vendor blogs, no primary
  data. Treat as anecdote.
- UNVERIFIED — "28% of failures are selectors": QA Wolf (commercial interest), no independent study.

## Reference implementations to study when building

- **Skyvern** — compile-to-Playwright for deterministic portions, LLM+vision only for ambiguous segments.
- **Workflow Use** (browser-use team) — record → script with swappable variable slots (the parameterization answer).
- **AgentRR** (arXiv 2505.17716) — two-level experience store: low-level script replay (stable UI) + high-level abstract procedure (adaptation).
- **arXiv 2603.20358** — zero-cost DOM/AX-tree self-healing blueprint (10-tier, no runtime LLM).

## Stats

Reddit 17 posts · X 25 posts · YouTube 8 videos (~430k views) · ~14 web/arXiv pages · 5 fact-checked.
