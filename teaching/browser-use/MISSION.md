# Mission: The browser stack, end to end

## Why
The browser stack (warm-chrome → browser-connect → browser-use → mcporter → chrome-devtools-mcp) was built largely by agents across many sessions. Nathan owns it but can't yet hold its architecture in his head — so architectural decisions (like the 13 open review findings on the envelope-derived-transport plan) get rubber-stamped instead of judged. The goal is to judge them himself.

## Success looks like
- Trace one real command (`browser-connect connect` → `browser-use targets list` → `operate`) end to end, naming which package owns each hop and why.
- Explain the Verified Handoff Envelope — what it carries, what it replaced, and why it is the only thing that crosses the seam.
- Answer "why are there three CLI tools?" in one sentence, from the failures that earned each seam.
- Adjudicate a plan-review finding on this stack (e.g., "should spawn facts persist in selected state?") with his own reasoning.

## Constraints
- ADHD: short lessons, one idea each, strong visual structure, generous whitespace.
- Sessions are opportunistic — a lesson must be completable in ~10 minutes.
- Teaching grounds in the repo's own docs (CONTEXT.md, decision logs, ADRs), never paraphrased from memory.

## Out of scope
- The dormant R9 router cluster internals (deliberately parked per Decision 2 — only the *fact* of its dormancy matters).
- browser-domain-memory / playback modes (archived; revisit if the roadmap revives it).
- warm-chrome proof-chain internals beyond what a consumer needs (own lesson later, if the mission still wants it).
