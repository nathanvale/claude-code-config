# journal-tidy

Throwaway prototype for **browser-domain-memory**.

## Question

WHEN are a flow's steps + selectors captured for durable memory — as the agent acts (**incremental**), or reconstructed at **end-of-run**?

Each pure approach has a fatal flaw:

- **incremental-only** persists the noise: fumbles, retries, dead scrolls.
- **end-of-run-only** loses **order + wait-for** fidelity (the bug that broke an earlier replay) and captures nothing if no journal was kept.

This prototype proves the answer is **hybrid**: journal-during → tidy-at-end → commit-on-verified.

## How to run

```bash
bun journal-tidy.ts
# from repo root:
bun prototypes/browser-use-uplift/journal-tidy/journal-tidy.ts
```

No browser, network, files, or `Date.now()`. Ordering is sequence indices. Deterministic, zero deps.

## Verdict

**Not either/or — hybrid: capture LIVE, clean at END, save only if it WORKED.** The three properties come from three different moments, so neither pure approach can deliver all of them:

- **ORDER + WAIT-FOR come from the live journal.** Only knowable while acting. Scenario 2: `Add` only exists after `select staff`. The journal kept `#2 select` before `#3 Add`. An end-of-run reconstruction from an unordered set yields `{Book Appointment, staff member, Add, Confirm}` with no ordering — it could emit `Add` first and break replay.
- **CLEANLINESS comes from the tidy pass.** Impossible live, because mid-run you don't yet know which clicks were fumbles. Scenario 1: `tidy()` dropped 5 of 9 entries (a fumble click, a no-effect scroll, two superseded retries, a snapshot) and kept the **corrected** selector `input[name='hours']` — not the fumble `button.add-photo` or the early flaky `#hrs`.
- **SAFETY comes from commit-on-verified.** Scenario 3: an ambiguous run (spinner stuck) produced a tidy 2-step runbook but was **discarded** — durable memory stayed empty. Only `confirmed` promotes (reuses the crash-safety sibling's commit boundary, independently).

So the answer to "when are selectors created?" is: **resolved and journaled live, filtered to the winning path at end-of-run, persisted only on verified success.**

## Findings for browser-domain-memory

- A raw **scratch journal** appended per-action during the run is the source of truth for order and wait-for metadata. Don't try to recover these after the fact — they're live-only.
- The journal must carry, per entry: `seq` (live order), action, target, the **real resolved selector** at action time, an optional `waitFor`, and a noise flag.
- `tidy(journal) -> runbook` needs three explicit noise rules:
  - `fumble` — flagged at capture (wrong element / not found). Never on the winning path.
  - `retry-superseded` — an attempt on a target a later entry hit cleanly. The successful entry wins; earlier tries are noise.
  - `no-effect` — a scroll/snapshot with no lasting state change.
- Signal = clean entry; when clean attempts share an `action::target`, the **last** one wins (the corrected selector), then survivors are re-sorted by `seq` and renumbered.
- Promote to durable memory only on `outcome === "confirmed"`. `failed`/`ambiguous` discard the tidied runbook, leaving durable untouched.
- Run output (this prototype): scenario 1 dropped 5/9 entries and kept the corrected selector; scenario 2 preserved select-before-Add; scenario 3 discarded an ambiguous run. All three invariant assertions passed.
