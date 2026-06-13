---
date: 2026-06-13
topic: wcag-a11y-oracle-spike
kind: research
status: proven-qualified
proof_artifacts:
  - skills/browser-use/src/prototype-playwright-vocab-map/run-wcag.ts
feeds:
  - skills/browser-use/docs/USE-CASES.md
settles: USE-CASES Mode 1 "WCAG via the a11y-tree differential oracle" claim
---

# WCAG-via-a11y-oracle spike — proven, qualified

The USE-CASES Mode 1 (engineering driver) claimed the differential oracle is a "free a11y
smoke test" because WCAG is about the accessibility tree and the engines compute it
independently — so engine disagreement on an element's accessible name flags a real a11y
defect. This spike tests that live.

## Method

Snapshot a page across all 5 engines, extract `{role, name}` per interactive element, and
detect: (A) **unnamed controls** — interactive elements ≥1 engine gives NO accessible name;
(B) **name-coverage divergence** — accessible names computed by some engines but not others.

## Results — caught both defect classes live

### W3C "before" inaccessible demo (designed to fail a11y)
- 0 unnamed controls (the engines' pipelines each synthesise *a* name).
- **2 name-coverage divergences:** `"bullet"` and `"1234 56789"` named only on the chrome
  lineage. `"bullet"` = a decorative bullet image chrome exposes with a name (decorative
  images should have NO accessible name — a real defect); `"1234 56789"` = a phone number
  pulled in as a control's name on one lineage only. Exactly the name-source ambiguity the
  thesis predicted.

### Hacker News (live, link-dense)
- **1 unnamed control** on the chrome lineage (WCAG 4.1.2 candidate — a screen reader
  announces it as "link" with no label).
- **82 name-coverage divergences** — chrome names the "N comments" links by comment count,
  chromium names the same DOM links by timestamp. Same element, two valid-but-different
  accessible names.

## Verdict — PROVEN, QUALIFIED

The oracle catches a real, distinct class of a11y defect: **accessible-name ambiguity** —
where independent a11y pipelines compute different names (or disagree on whether a name
exists) for the same element. That signal is genuine:

- **For the agent (Mode 1):** acting by name is engine-fragile exactly where names diverge.
- **For accessibility:** if two good engines can't agree what a control is called, a real
  screen reader's announcement is non-deterministic too — a WCAG-relevant smell.

**The honest scope (do not overclaim):** the differential a11y oracle is **NOT a replacement
for axe-core / Lighthouse.** It does not check colour contrast, ARIA validity, focus order,
or most WCAG success criteria. It catches ONE thing those tools structurally cannot:
**cross-pipeline name ambiguity**, because that requires ≥2 independent a11y computations to
detect. It is a *complementary* signal, not a full scanner.

- Use it for: "is this control's accessible name stable/unambiguous across implementations?"
- Pair it with: a real WCAG scanner (axe/Lighthouse — which chrome-devtools can run natively
  as a separate Mode-1 check) for full coverage.

## What this means for USE-CASES Mode 1

The "WCAG via the a11y-tree oracle" claim holds, reworded: the oracle is a **name-ambiguity
detector** (a a11y dividend unique to N-engine), and **chrome-devtools' native Lighthouse**
is the full-coverage WCAG scanner. Mode 1's three checks are then sharper:
- React memory/perf → chrome-devtools native tooling
- WCAG → chrome-devtools Lighthouse (full scan) + the oracle (name-ambiguity, the unique bit)
- Figma parity → playwright capture + diff

## Status

Throwaway spike (`run-wcag.ts`). The qualified verdict + the name-ambiguity framing are the
keepers. Re-run:

    bun skills/browser-use/src/prototype-playwright-vocab-map/run-wcag.ts https://news.ycombinator.com
