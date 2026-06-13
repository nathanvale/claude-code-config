# Use cases — the two daily-driver modes

The product is a browser-trust layer (one warm Chrome, N independent engines, mechanical
oracle). It earns its keep in two daily-driver modes that share **one spine** — warm Chrome
+ N-engine trust layer + the auth/redaction moat — but serve different people and different
stakes. See `PRODUCT.md` for the core definition; this doc grounds it in real work.

---

## Mode 1 — Engineering driver (human supervises)

**Who:** a software engineer (the experience-sdk project). **Loop:** the agent runs checks
autonomously; the human reviews results. **Stakes:** wrong result wastes time, not money.

The killer fit: each check is best served by a *different* engine — engine-strength
composition, not redundancy.

| Daily check | Strongest engine | Why |
|---|---|---|
| **React memory + performance (Chrome)** | chrome-devtools | the only engine with the 44-tool debug surface — heap snapshots, performance traces, real DevTools memory tooling |
| **WCAG accessibility compliance** | the differential oracle over the a11y trees | WCAG *is* about the accessibility tree; engines compute it independently, so when they disagree on an element's accessible name (the live "119 comments" vs "3 hours ago" finding) that disagreement is often a real a11y defect — an ambiguous name a screen reader would also stumble on. A free a11y smoke test. |
| **Figma ↔ implementation design-parity** | playwright (robust capture) + screenshot diff | auto-wait robustness for stable capture, then compare against the Figma node |

**Why the trust layer matters here:** when the agent reports "parity passed" or "no WCAG
violations," the human can believe it — it's cross-checked, and the silent-no-op problem is
caught (an engine can't falsely report "check passed" when it actually saw nothing). Lets
the checks run autonomously instead of needing a human to drive each one.

---

## Mode 2 — No-touch life-admin driver (NO human in the loop)

**Who:** anyone. **Loop:** the agent does tedious tasks the human doesn't want to —
**filling timesheets, booking dog grooming, medical appointments** — fully unattended,
driven by **runbooks** (the repeatable how-to per task) and a **1Password vault**
(credentials for no-touch login). **Stakes:** wrong result is real-world and unrecoverable.

**This mode is where the trust layer goes from nice-to-have to NON-NEGOTIABLE.** No-touch
operation is exactly where a single-engine agent is most dangerous: with nobody watching,
if the agent books the wrong slot, submits the wrong hours, or clicks the wrong "Confirm,"
there is no human to catch it.

The moat maps directly onto the no-touch requirements:

| No-touch need | The product mechanism | Why it's required (not optional) |
|---|---|---|
| Don't fire a wrong irreversible action | **quorum gate + signed receipt** | before "Confirm Booking", k engines must agree the page shows the right vet / date / dog. The receipt is the proof afterward: "3 engines confirmed Tue 2pm with Dr. Smith before booking." With no human watching, consensus IS the safety. |
| Catch silent failure | **post-state verify** (R7) | a timesheet that "submitted" but didn't is invisible to the agent's return value; only verifying the post-state catches it. Unattended, this is the difference between "hours logged" and "silently lost." |
| No-touch login | **1Password vault → the auth boundary** | credentials flow in for unattended login; the one-password skill owns the vault. |
| Don't leak the secrets | **redaction boundary** (R8; CDP = root over web identity) | no-touch credential use is *exactly why* redaction is mandatory — secrets must never reach logs/transcripts. The property that enables the mode also mandates the boundary. |
| Repeatable task definition | **runbooks** | the per-domain how-to; ties into browser-domain-memory (durable per-domain knowledge). |

---

## The shared spine (why it's one product, not two)

```
            Mode 1: engineering driver        Mode 2: no-touch life-admin
            (human supervises)                (no human in the loop)
                     │                                  │
                     └──────────────┬───────────────────┘
                                    ▼
              ONE TRUST SPINE  (warm Chrome + N engines + oracle)
              ├─ confidence-annotated perception (seen_by: N/5)
              ├─ quorum gate + signed receipt (irreversible actions)
              ├─ post-state verify (catch silent no-ops)
              ├─ graceful failover (engine dies → task completes)
              └─ auth + redaction boundary (1Password in, secrets never out)
```

- **Mode 1 sells to developers** — "ship autonomous checks you can trust."
- **Mode 2 sells to everyone** — "let an agent do your life admin, safely, unattended."
- **Mode 2 is where the trust layer is a requirement, not a differentiator** — the strongest
  argument for the whole product: no single-engine agent can be trusted to act unattended
  on something irreversible, because it cannot be a second opinion on itself.

## Pitch line per mode

- **Mode 1:** *"Autonomous design-parity, accessibility, and performance checks your agent
  runs daily — cross-checked by five engines, so 'passed' actually means passed."*
- **Mode 2:** *"The agent does the admin you hate — timesheets, appointments — unattended,
  and won't fire a wrong irreversible click because five independent eyes have to agree
  first. With a signed receipt to prove it."*

## Status

Product-definition use cases, grounded in real intended daily use. The trust mechanisms
each cite (quorum, post-state verify, redaction, failover) are proven this session; the
engine-strength composition for Mode 1's three checks is a strong claim awaiting a per-check
spike (WCAG-via-a11y-oracle is the most compelling and is the next candidate). 1Password +
runbooks are owned by the one-password skill and browser-domain-memory respectively.
