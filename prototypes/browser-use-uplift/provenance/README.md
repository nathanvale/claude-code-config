# PROTOTYPE — provenance + confidence drives re-verify (throwaway)

**Question:** When an agent recalls captured selectors from browser-domain-memory,
not all are equally trustworthy. A selector found via a stable `#id` is gold; one
found by a generic CSS class, fuzzy text match, or that was already HEALED after
drift is shaky. Can we (1) record HOW each selector was resolved (provenance),
(2) derive a CONFIDENCE score from it, and (3) use that score to decide how hard
to RE-VERIFY each selector before trusting it on the next run?

**Answer: yes — provenance is the input, confidence is the dial, re-verify is the gate.**

Each captured selector stores a `provenance` tag for how it was resolved. A named
`CONFIDENCE` map turns that tag into a score; a single `TRUST_THRESHOLD` (0.7) gates
the decision. Confidence also DECAYS per prior heal, so a selector that keeps
drifting keeps re-verifying until it stabilises.

## Run

```
bun prototypes/browser-use-uplift/provenance/provenance.ts
```

No live browser. Selectors + provenance are in-memory data; pure and deterministic.

## Verdict

✓ Provenance-derived confidence cleanly gates re-verification. Actual run output:

```
selector                                   provenance    conf   decision
-------------------------------------------------------------------------
#MainContent_LoginControl_UserName         by-id         0.95   TRUST
[data-testid='login-submit']               by-testid     0.90   TRUST
input[name='password']                     by-name       0.85   TRUST
[role='region'][aria-label='Services']     by-aria       0.80   TRUST
.service-row                               by-css-class  0.50   RE-VERIFY
text/Add                                   by-text-fuzzy 0.40   RE-VERIFY
[role=option]:nth-child(2)                 by-heal       0.20   RE-VERIFY  ← decayed: 1 prior heal(s)
.time-slot                                 by-css-class  0.30   RE-VERIFY  ← decayed: 2 prior heal(s)

=== RESULT: 4 trusted (cheap/no check), 4 flagged for RE-VERIFY before use ===
```

All high-confidence selectors (id/testid/name/aria) are trusted with a cheap/no
check; all weak ones (css-class/text-fuzzy/healed) are flagged to re-verify before
use. The decay demo shows a `by-css-class` selector sinking 0.50 → 0.40 → 0.30 as
heals stack, and dropping to 0.20 once it is re-found via heal (provenance
downgraded to `by-heal`) — so a flaky selector keeps re-verifying.

## Findings for browser-domain-memory

1. **Store provenance at capture, not just the selector string.** The single most
   useful field is HOW the selector was resolved (`by-id` … `by-heal`). Everything
   downstream — confidence, re-verify aggressiveness, decay — keys off it. A bare
   selector with no provenance can't be triaged on recall.

2. **Confidence is a derived dial, not a stored fact.** Keep one explicit
   `provenance → confidence` map + one `TRUST_THRESHOLD` as named constants. Tuning
   re-verify aggressiveness is then a one-line change, not a data migration.

3. **Heals must decay confidence, or you re-heal forever silently.** A selector
   that needed healing on prior runs is, by evidence, fragile. Downgrading its
   provenance to `by-heal` and stacking a per-heal penalty makes the system keep
   re-verifying it until it is recaptured by a stable strategy — turning silent
   repeated heals into a visible "this selector is rotting" signal.

4. **The gate is the cheap win.** High-confidence selectors (id/testid/name/aria,
   the top ~half here) skip re-verification entirely on recall — cheap fast path.
   Only the weak tail pays the re-discover/re-check cost. Provenance lets memory
   spend verification budget exactly where drift risk lives.

## Throwaway

Fold the `provenance` field, the confidence map, the trust threshold, and the
heal-decay rule into the browser-domain-memory capture + recall contract once
decided.
