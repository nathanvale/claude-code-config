# Verify pass — refuter contract

Step 8 of unit-review. One refuter per blocker/major finding. Purpose: drop findings that don't survive an attempt to disprove them, so the report carries verified precision, not raw recall.

## Refuter input bundle (per finding)
- The finding: severity, `file:line`, what, why, recommended action.
- The cited code: the exact lines at `file:line` plus enough surrounding context to judge (read the file, don't trust the quote).
- The unit's do-not-flag list (so a refuter doesn't "validate" a finding that's actually an accepted decision).

## Refuter task
Try to prove the finding WRONG. Read the real code, not the finding's paraphrase. Default to refuted when uncertain — a finding only survives if it clearly holds.

## Output contract
`{ validated: true | false, reason: "<one line>" }`
- `validated: true` → the finding holds; keep it (severity may be adjusted with a reason).
- `validated: false` → refuted; drop it (the report may note "considered, refuted: <reason>" at most).

## Conservative-on-failure (non-negotiable)
If the refuter errors, times out, or returns anything not matching the contract → treat as `validated: false` and DROP the finding. A broken refuter must NEVER pass a finding through unverified. This bias keeps the gate honest: the cost of a dropped real finding is a missed comment; the cost of a passed hallucination is a wrong fix to live code.

## Scope
Refuters are read-only. They never edit code. Bound the batch to the blocker/major set — minors/nits skip the verify pass (cheaper to let a stray nit through than to verify every one).
