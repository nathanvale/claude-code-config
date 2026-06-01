# PROTOTYPE — capture verification (throwaway)

**Question:** Can captured browser memory store the RIGHT selector, and
self-detect/heal when it's wrong — so a confident-wrong capture never silently
poisons the next run?

**Answer: YES.** Two verification gates make captured selectors self-correcting.

## Why this matters

A prior prototype proved recall SPEEDUP but exposed a silent-failure bug: a naive
text-hint discovery captured the USERNAME field's selector for the "submit"
target, and the next run confidently reused the wrong selector. Confident-wrong
memory is worse than no memory — it fails silently. This prototype adds the
verification layer that catches it.

## The two gates (the core)

Each verifiable target (`username`, `password`, `submit`) has an explicit
**assert predicate** = its expected element shape:

- `username` → input, type `text|email`
- `password` → input, type `password`
- `submit` → `button` / `type=submit` with submit-like text (`log in`, `sign in`, ...)

1. **GATE 1 — capture-time assert.** After resolving a selector, verify the
   element matches the target's assert BEFORE storing. On fail → reject and
   rediscover by shape, store the corrected selector. Never persist garbage.
2. **GATE 2 — recall-time re-verify.** Before trusting a stored selector on a
   later run, cheaply confirm it still resolves to a matching element. On drift →
   rediscover + RE-CAPTURE the corrected selector. Self-correcting memory.

## The bug, reproduced deliberately

The page is an in-memory DOM fixture (zero deps, deterministic — no live browser,
because shared Chrome :9444 is single-driver). It models a real ASP.NET WebForms
login where the username field's id is `MainContent_LoginControl_UserName` — it
contains the substring `login`. The naive discovery for "submit" uses hint
`login` and grabs that USERNAME field first (DOM order, no shape check). Gate 1
catches it.

Drift is simulated by mutating the fixture between recall runs: the submit
button's id changes (`LoginButton` → `SubmitBtn`), staling the stored selector.
Gate 2 catches it.

## Run

```
bun prototypes/browser-use-uplift/capture-verify/verify.ts
```

## Verdict

Real run output (verdict lines):

```
Gate 1 (capture-assert) caught the wrong-selector bug + stored the corrected one: ✓
Gate 2 (recall re-verify) detected simulated drift + self-healed the memory: ✓
✓ PROVEN: verification gates make captured memory self-correcting — no confident-wrong selectors survive.
```

- **Gate 1 fired:** naive discovery resolved `submit` to
  `#MainContent_LoginControl_UserName` (type=text) → assert FAILED → rejected →
  rediscovered by shape → stored `#MainContent_LoginControl_LoginButton`. The
  wrong selector never reached the store.
- **Gate 2 fired:** after the submit id drifted, recall re-verify saw the stored
  selector resolve to nothing → rediscovered + re-captured
  `#MainContent_LoginControl_SubmitBtn`. Memory corrected for the next run.

## Findings for browser-domain-memory

1. **Capture without verification is a liability, not an asset.** A naive
   text/id-hint discovery WILL occasionally resolve the wrong element (ASP.NET id
   collisions like `LoginControl_UserName` containing `login` are common). Storing
   it unverified produces confident-wrong memory. Every captured selector must
   pass its target's assert before persisting.
2. **The assert predicate is the durable contract — store it alongside the
   selector.** Shape (`type=password`, `type=submit`, submit-like text) survives
   id/class churn far better than the selector string. It is BOTH the capture gate
   and the recall gate, and it powers shape-based rediscovery when a selector dies.
3. **Recall must re-verify, not just resolve.** A stored selector that resolves to
   SOMETHING is not enough — confirm the something still matches the expected
   shape. Resolving to the wrong element (or nothing) both mean drift → rediscover
   + re-capture.
4. **Self-healing belongs in recall, and it should write back.** When Gate 2
   re-captures, it updates the store so the correction compounds — the next run
   starts from healed memory, not the stale selector. Pairs with the selector
   fallback ladder proved in the `self-healing/` prototype.

## Throwaway

Fold the assert-predicate + two-gate contract into the browser-domain-memory
capture/recall path: store `{selector, assert}` per field; gate writes on capture,
gate reads on recall; on either failure, rediscover by assert shape and write back.
