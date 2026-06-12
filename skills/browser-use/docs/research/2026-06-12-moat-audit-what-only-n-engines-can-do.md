---
date: 2026-06-12
topic: moat-audit-what-only-n-engines-can-do
kind: research
status: decided
supersedes_claims_in:
  - skills/browser-use/src/prototype-playwright-vocab-map/DIVIDENDS-ROUND2B-NOTES.md
feeds:
  - skills/browser-use/docs/brainstorms/2026-06-12-browser-use-multi-engine-facade-requirements.md
---

# Moat audit — what ONLY N engines can do (and what one capable engine could too)

Triggered by the right question: **"why is this compelling if chrome-devtools could do
all of it?"** chrome-devtools ships 44 tools — it can click, read network, read console,
take heap snapshots. So any dividend a single capable engine could replicate is a
convenience, not a moat. This audit separates the two.

## The test

For each dividend: **does it require N independently-implemented engines, or just N
tools?** If chrome-devtools alone could do it, it is not a moat.

## Result

| Dividend | One capable engine alone? | Verdict |
|---|---|---|
| Differential oracle (consensus on page content) | No — one engine has one a11y pipeline; it cannot disagree with itself | **STRUCTURAL MOAT** |
| Confidence-annotated perception (`seen_by: N/5`) | No — the score IS cross-engine agreement; at N=1 everything is 1/1 | **STRUCTURAL MOAT** |
| Quorum-gated action + receipt | No — Byzantine fault tolerance needs independent replicas; one engine read twice = same (possibly wrong) answer | **STRUCTURAL MOAT** |
| Reproduce-everywhere (bug vs engine-artifact) | No — "does only MY engine think it's gone?" is unanswerable from inside one engine | **STRUCTURAL MOAT** |
| Graceful degradation / failover | No — an engine cannot fail over to itself; when Chrome breaks its own CDP path (136, 144) chrome-devtools has nowhere to go | **STRUCTURAL MOAT** |
| Cloaking detection (different content per fingerprint) | No — needs ≥2 distinct fingerprints to compare | **STRUCTURAL MOAT** |
| Cost-routing (cheapest capable engine) | N/A at N=1 — routing between engines presupposes N>1 | MOAT (definitionally N>1) |
| **Drive-observe split** | **YES — chrome-devtools can click AND read network in one session** | **CONVENIENCE, not moat** |
| Payload tiering (lean vs full snapshot) | Mostly yes — one engine offers verbose/terse modes (chrome `--slim`) | WEAK / mostly single-engine |

## The irreducible moat (one sentence)

**chrome-devtools cannot be a second opinion on itself.** Consensus, quorum, failover,
and bug-vs-artifact triage are impossible from inside one engine *no matter how many tools
it has*, because they all depend on independent implementations disagreeing. That is the
moat — not "we orchestrate engines better."

Concrete proof from this session: chrome lineage names a Hacker News link `"119 comments"`;
chromium lineage names the SAME link `"3 hours ago"`. An agent told "click 119 comments"
succeeds on one lineage, fails on the other — and a single engine reports its one answer
with full confidence and no signal that it might be wrong. Only a second, independently
implemented engine surfaces the divergence.

## Drive-observe: demoted to convenience

The round-2b drive-observe demo (playwright drives, chrome-devtools observes network) ran
clean on example.com — but example.com is a STATIC link, so chrome-devtools could have
done both halves itself. Drive-observe only beats a single engine when the DRIVER GAP is
real: a control playwright's auto-wait can click but chrome's fire-and-forget misses.

Attempt to prove the driver gap live was **inconclusive**: synthetic test pages hit
a11y-snapshot edge cases (disabled buttons pruned from the tree; full/partial overlays
disrupting capture; a localhost page that chrome-devtools did not surface in its snapshot
at all). The driver gap is a real, documented phenomenon — it is why Playwright built
actionability checks — but it was NOT proven in this harness, and the difficulty of even
staging it cleanly confirms it is an edge case, not a core value.

Conclusion: **drive-observe is a real convenience on pages with a genuine driver gap, but
it is not a structural moat** — a sufficiently capable single engine can do it. Requirement
R14 is reclassified accordingly (convenience, lower priority; not part of the moat case).

## What this changes

- The product thesis answer to "why not just chrome?" is the N-witness family, full stop:
  oracle, confidence perception, quorum + receipt, repro, failover, cloaking detection.
- Drive-observe and payload-tiering stay as nice-to-haves but must NOT be sold as
  "chrome can't do this."
- This is the session's most important correction. The user's challenge made the thesis
  honest: the moat is narrower than the round-2 ideation implied, and therefore defensible.

## Status

Decision record. No throwaway code kept beyond the inconclusive `run-driver-gap.ts`
(retained as evidence the gap is hard to stage, not as a passing demo).
