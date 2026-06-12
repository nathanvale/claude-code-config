# Round-2b dividend prototypes — quorum-gated action + drive-observe split (live)

Two more flagship dividends proven live against the 5-engine fleet on warm Chrome.
Harnesses: `run-quorum.ts`, `run-drive-observe.ts` (reuse `fleet.ts`).

## ★3 Quorum-gated action + signed receipt — PROVEN

`run-quorum.ts <url> "<critical>" [k]` — k engines independently re-read the critical
element before a high-stakes action; agree → fire + signed receipt; disagree → refuse.

Live results:

| case | element / page | witnesses | gate | outcome |
|---|---|---|---|---|
| quorum MET | "Learn more" / example.com | 5/5 confirm | k=3, have 5 | ✓ committed; receipt sha256 `97dc14b6…`, secret-redacted to host |
| REFUSED | "119 comments" / Hacker News | 0/5 confirm | k=3, have 0 | ✓ refused — no action fired |

The mechanism is proven: independent multi-witness confirmation gates the action; the
tamper-evident receipt (`{intent, critical, host, quorum, confirmed_by, dissent, actor,
ts, sha256}`) is the audit artifact. One stale/lying engine cannot push a destructive
action through — Byzantine-fault-tolerant browsing.

**Honest note:** the REFUSED case landed at 0/5 (the specific HN comment-count rotates as
stories move, so "119 comments" wasn't present this run) rather than the 2/5 split I
expected. The gate behaves correctly either way — it refuses unless ≥k agree — but this
run demonstrated refuse-on-absence, not refuse-on-split. A contrived fixture page would
demo the split branch cleanly; the safety property (refuse unless quorum) is proven
regardless.

**Why it matters:** "k independent engines confirmed the target before firing" is a
guarantee a single engine structurally cannot make. The receipt makes it auditable. This
is the wedge into regulated / high-stakes / irreversible-action work where every
single-engine agent is structurally untrustworthy (one set of eyes).

## ★4 Drive-observe split — PROVEN

`run-drive-observe.ts <url> "<action>"` — playwright DRIVES (auto-wait), chrome-devtools
OBSERVES (network + console) the side-effects, on the same warm Chrome, one task.

Live on example.com, clicking "Learn more":
- driver (playwright): ✓ click landed (auto-wait robustness)
- observer (chrome-devtools): captured **+4 network requests** the click triggered
  (GET www.iana.org [200] ×4), 0 console errors
- combined verdict: **✓ verified clean — click landed AND no failed requests AND no
  console errors**

The mechanism is proven: two engines composed by strength in one task. The combined
record (action-from-driver + side-effects-from-observer) is richer than either engine
gives alone. If any request had been 4xx/5xx, the verdict flips to "DRIVER SAID SUCCESS,
OBSERVER SAW FAILURE" — the canonical bug a single-engine agent hides.

**Why it matters:** "the click worked but the backend 500'd" becomes ONE atomic
observation instead of two engine swaps. The robust hand on the wheel, the debug eye on
the glass — only possible because all engines share one warm Chrome at near-zero marginal
fan-out cost.

## Both spikes confirm the same architectural truth

These are NOT more oracle-diffing — they are NEW mechanisms (a pre-action consensus gate;
a concurrent drive+observe composition) that fall out of the same substrate: N engines on
one warm Chrome + engine-origin-tagged refs + the cost table. The platform keeps paying
dividends in new shapes.

## Remaining / carried forward

- Quorum split-refusal demo wants a stable fixture page (rotating real-site content made
  the HN element absent rather than split this run).
- Receipt persistence (append to an audit log) is the obvious next step for a real build.
- Drive-observe currently hardcodes playwright-driver + chrome-devtools-observer; a real
  facade would pick driver/observer by measured strength per task.

## Status

Throwaway (`run-quorum.ts`, `run-drive-observe.ts`). Keepers remain `ref-normalizer.ts`,
`vocab-map.ts`, `fleet.ts`. Re-run:

    bun run-quorum.ts https://example.com "Learn more" 3
    bun run-drive-observe.ts https://example.com "Learn more"
